/**
 * Bubble Trouble — a visual outliner for SketchUp.
 *
 * Right now this is just the skeleton from the JSA "sidebar-panel" example:
 * it connects, then shows how many elements are selected so you can confirm
 * the extension is alive. No outliner logic yet.
 *
 *   1. State
 *   2. UI
 *   3. Observing the selection
 *   4. Init & connection
 */

// ---------------------------------------------------------------------------
// 1. State
// ---------------------------------------------------------------------------

let model = null;
let selectionObserver = null;

// ---------------------------------------------------------------------------
// 2. UI
// ---------------------------------------------------------------------------

document.body.innerHTML = `
  <h2>Bubble Trouble</h2>
  <p id="status">Connecting to SketchUp…</p>
  <p id="selection"></p>
`;

const statusEl = document.getElementById('status');
const selectionEl = document.getElementById('selection');

// ---------------------------------------------------------------------------
// 3. Observing the selection
// ---------------------------------------------------------------------------

function showSelection(metadata) {
  const count = metadata.totalNumberOfElements;
  selectionEl.textContent =
    count === 0 ? 'Nothing selected'
    : count === 1 ? '1 element selected'
    : `${count} elements selected`;
}

/** observeSelectionMetadata returns its handle synchronously — no await. */
function startObserving() {
  selectionObserver = model.observeSelectionMetadata(showSelection);
}

function stopObserving() {
  selectionObserver?.stop();
  selectionObserver = null;
}

// ---------------------------------------------------------------------------
// 4. Init & connection
// ---------------------------------------------------------------------------

try {
  await SketchUpApi.connect();
  model = await SketchUpApi.getActiveModel();

  startObserving();
  window.addEventListener('pagehide', stopObserving);

  statusEl.textContent = `Connected (served from ${location.origin})`;
} catch (e) {
  console.error('Bubble Trouble init error:', e);
  statusEl.className = 'error';
  statusEl.textContent = `Failed to connect to SketchUp: ${e.message}`;
}
