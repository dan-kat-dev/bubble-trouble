# Bubble Trouble for SketchUp desktop.
#
# Desktop SketchUp doesn't have the JS API yet, so this file stands in for it.
# It opens the same Vue app in an HtmlDialog and answers its few requests:
#
#   JS -> Ruby: sketchup.getSnapshot(), sketchup.select(path), sketchup.zoomToSelection()
#   Ruby -> JS: bubbleTrouble.snapshot(data), .modelChanged(), .selectionChanged(ids)
#
# The other half is src/sketchup/ruby-source.ts. When desktop gets the JS API,
# delete ruby/ and that file.

require 'json'

module BubbleTrouble
  # Bundled into the .rbz by `npm run rbz`. Missing when running from the repo,
  # in which case the dialog loads the Vite dev server (hot reload).
  HTML = File.join(__dir__, 'html', 'index.html')
  DEV_URL = 'https://localhost:9000/'

  # ---------------------------------------------------------------------------
  # 1. The dialog
  # ---------------------------------------------------------------------------

  def self.show
    return @dialog.bring_to_front if @dialog&.visible?

    @dialog = UI::HtmlDialog.new(
      dialog_title: 'Bubble Trouble',
      preferences_key: 'BubbleTrouble',
      width: 360,
      height: 640,
      style: UI::HtmlDialog::STYLE_DIALOG
    )
    @dialog.add_action_callback('getSnapshot') do |_context|
      send_js('snapshot', snapshot(Sketchup.active_model))
      send_selection
    end
    @dialog.add_action_callback('select') do |_context, path|
      select(Sketchup.active_model, path)
    end
    @dialog.add_action_callback('zoomToSelection') do |_context|
      model = Sketchup.active_model
      model.active_view.zoom(model.selection) unless model.selection.empty?
    end
    @dialog.set_on_closed { stop_watching }

    File.exist?(HTML) ? @dialog.set_file(HTML) : @dialog.set_url(DEV_URL)
    @dialog.show
    start_watching
  end

  # Call a bubbleTrouble.* function in the dialog, passing data as JSON.
  def self.send_js(function, data = nil)
    return unless @dialog&.visible?

    @dialog.execute_script("window.bubbleTrouble && bubbleTrouble.#{function}(#{data.nil? ? '' : data.to_json})")
  end

  # ---------------------------------------------------------------------------
  # 2. Reading the model: the same snapshot shape the web version builds
  # ---------------------------------------------------------------------------

  def self.snapshot(model)
    definitions = model.definitions.reject(&:image?).map do |definition|
      container(definition.entityID, definition.name, definition.entities)
    end
    { title: model.title, root: container(-1, model.title, model.entities), definitions: definitions }
  end

  # A definition's own face and edge counts plus its child instances.
  def self.container(id, name, entities)
    info = { id: id, name: name, faces: 0, edges: 0, children: [] }
    entities.each do |entity|
      case entity
      when Sketchup::Face then info[:faces] += 1
      when Sketchup::Edge then info[:edges] += 1
      when Sketchup::Group, Sketchup::ComponentInstance
        info[:children] << {
          entityId: entity.entityID,
          name: entity.name,
          definitionId: entity.definition.entityID,
          kind: entity.is_a?(Sketchup::Group) ? 'group' : 'component'
        }
      end
    end
    info
  end

  # ---------------------------------------------------------------------------
  # 3. Selecting, including nested instances
  # ---------------------------------------------------------------------------

  # `path` is entity ids from the top level down. Opens the parents (like
  # double-clicking into them), then selects the last one.
  def self.select(model, path)
    instances = []
    entities = model.entities
    Array(path).each do |id|
      instance = entities.find { |e| e.entityID == id.to_i && e.respond_to?(:definition) }
      return unless instance

      instances << instance
      entities = instance.definition.entities
    end

    model.selection.clear
    return if instances.empty?

    parents = instances[0...-1]
    model.active_path = parents.empty? ? nil : parents
    model.selection.add(instances.last)
  end

  def self.send_selection
    selection = Sketchup.active_model.selection
    send_js('selectionChanged', selection.select { |e| e.respond_to?(:definition) }.map(&:entityID))
  end

  # ---------------------------------------------------------------------------
  # 4. Watching for changes while the dialog is open
  # ---------------------------------------------------------------------------

  class ModelWatcher < Sketchup::ModelObserver
    def onTransactionCommit(_model)
      BubbleTrouble.send_js('modelChanged')
    end
    alias_method :onTransactionUndo, :onTransactionCommit
    alias_method :onTransactionRedo, :onTransactionCommit
  end

  class SelectionWatcher < Sketchup::SelectionObserver
    def onSelectionBulkChange(_selection)
      BubbleTrouble.send_selection
    end
    alias_method :onSelectionCleared, :onSelectionBulkChange
    alias_method :onSelectionAdded, :onSelectionBulkChange
    alias_method :onSelectionRemoved, :onSelectionBulkChange
  end

  # A new or opened model replaces the active one: move the watchers over.
  class AppWatcher < Sketchup::AppObserver
    def onNewModel(model)
      BubbleTrouble.watch(model)
      BubbleTrouble.send_js('modelChanged')
    end
    alias_method :onOpenModel, :onNewModel
  end

  def self.start_watching
    @app_watcher ||= AppWatcher.new
    Sketchup.add_observer(@app_watcher)
    watch(Sketchup.active_model)
  end

  def self.watch(model)
    unwatch
    @model_watcher ||= ModelWatcher.new
    @selection_watcher ||= SelectionWatcher.new
    model.add_observer(@model_watcher)
    model.selection.add_observer(@selection_watcher)
    @model = model
  end

  def self.unwatch
    return unless @model

    begin
      @model.remove_observer(@model_watcher)
      @model.selection.remove_observer(@selection_watcher)
    rescue StandardError
      # The old model may already be closed.
    end
    @model = nil
  end

  def self.stop_watching
    unwatch
    Sketchup.remove_observer(@app_watcher) if @app_watcher
  end

  # ---------------------------------------------------------------------------
  # 5. Menu
  # ---------------------------------------------------------------------------

  unless file_loaded?(__FILE__)
    UI.menu('Extensions').add_item('Bubble Trouble') { show }
    file_loaded(__FILE__)
  end
end
