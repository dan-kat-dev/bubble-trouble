# Bubble Trouble: SketchUp desktop loader.
#
# SketchUp loads every .rb file in its Plugins folder at startup. This one only
# registers the extension (so it shows up in Extension Manager); the real code
# is in bubble_trouble/main.rb.

require 'sketchup.rb'
require 'extensions.rb'

module BubbleTrouble
  VERSION = '0.1.0' # keep in sync with public/manifest.json (npm run rbz checks)

  unless file_loaded?(__FILE__)
    extension = SketchupExtension.new('Bubble Trouble', File.join(__dir__, 'bubble_trouble', 'main'))
    extension.version = VERSION
    extension.creator = 'Daniel Kat'
    extension.copyright = '2026 Daniel Kat'
    extension.description = 'A visual outliner: see, search and select everything in your model at a glance.'
    Sketchup.register_extension(extension, true)
    file_loaded(__FILE__)
  end
end
