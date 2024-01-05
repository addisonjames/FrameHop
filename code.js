let history = [];
let currentIndex = -1;
let favorites = [];

function updatePluginData() {
  const data = { history, currentIndex, favorites };
  figma.root.setPluginData("frameHopData", JSON.stringify(data));
}

function loadPluginData() {
  const data = figma.root.getPluginData("frameHopData");
  if (data) {
    const parsedData = JSON.parse(data);
    history = parsedData.history || [];
    currentIndex = parsedData.currentIndex || -1;
    favorites = parsedData.favorites || [];
  } else {
    history = [];
    currentIndex = -1;
    favorites = [];
    updatePluginData();
  }
  updateUI();
}

function updateUI() {
  // Prepare the recentHistory and currentFrameId
  const recentHistory = history
    .slice(-16)
    .reverse()
    .map((item) => {
      const frame = figma.getNodeById(item.frameId);
      const page = frame ? figma.getNodeById(item.pageId) : null;
      return frame && page
        ? {
            id: frame.id,
            name: frame.name,
            pageId: page.id,
            pageName: page.name,
          }
        : null;
    })
    .filter((frame) => frame !== null);

  const currentFrameId =
    figma.currentPage.selection.length > 0
      ? figma.currentPage.selection[0].id
      : null;
  const currentPageId = figma.currentPage.id;

  // Send the message to the UI with the recent history, current frame ID, and favorites
  figma.ui.postMessage({
    type: "update",
    historyData: recentHistory,
    currentFrameId,
    currentPageId,
    favorites,
  });
}

// Function to jump to a specific frame
function jumpToFrame(frameId) {
  // Find the page that contains the frame
  let targetPage = null;
  let targetFrame = null;

  figma.root.children.forEach((page) => {
    let frame = page.findOne((node) => node.id === frameId);
    if (frame) {
      targetPage = page;
      targetFrame = frame;
    }
  });

  if (targetPage && targetFrame) {
    // Switch to the page containing the frame
    figma.currentPage = targetPage;
    // Select the frame
    figma.currentPage.selection = [targetFrame];
    figma.viewport.scrollAndZoomIntoView([targetFrame]);
    console.log("Jumped to Frame:", frameId, "on Page:", targetPage.name);
  } else {
    console.log("Frame not found:", frameId);
  }
  updateUI();
}

// Function to record the frame ID and page ID when a new frame is selected
function updateHistory() {
  const currentSelection = figma.currentPage.selection;
  if (currentSelection.length > 0) {
    const selectedItem = currentSelection[0];
    const itemType = selectedItem.type;
    if (
      itemType === "FRAME" ||
      itemType === "COMPONENT" ||
      itemType === "COMPONENT_SET"
    ) {
      const itemId = selectedItem.id;
      const pageId = selectedItem.parent.id;
      const item = { frameId: itemId, pageId: pageId };

      // Check if item is already in history
      const itemIndex = history.findIndex(
        (h) => h.frameId === itemId && h.pageId === pageId
      );
      if (itemIndex === -1) {
        // If item is not in history, add it and update currentIndex
        history.push(item);
        currentIndex = history.length - 1;
      } else {
        // If item is already in history, just update currentIndex
        currentIndex = itemIndex;
      }
      console.log("updateHistory - currentIndex:", currentIndex);
      updatePluginData();
    }
  }
  updateUI();
}

// Handle hopping forwards in history
function hopForwards() {
  console.log(
    "Before Hop Forwards: currentIndex =",
    currentIndex,
    ", history =",
    history
  );
  loadPluginData();
  if (currentIndex < history.length - 1) {
    currentIndex += 1;
    jumpToFrame(history[currentIndex]);
    updatePluginData();
  }
  console.log(
    "After Hop Forwards: currentIndex =",
    currentIndex,
    ", history =",
    history
  );
}

// Handle hopping backwards in history
function hopBackwards() {
  console.log(
    "Before Hop Backwards: currentIndex =",
    currentIndex,
    ", history =",
    history
  );
  loadPluginData();
  if (currentIndex > 0) {
    currentIndex -= 1;
    jumpToFrame(history[currentIndex]);
    updatePluginData();
  }
  console.log(
    "After Hop Backwards: currentIndex =",
    currentIndex,
    ", history =",
    history
  );
}

// Message handling from the UI
figma.ui.onmessage = (msg) => {
  switch (msg.type) {
    case "jumpToFrame":
      jumpToFrame(msg.frameId);
      break;
    case "clearData":
      history = [];
      currentIndex = -1;
      favorites = [];
      updatePluginData();
      updateUI();
      break;
    case "updateFavorites":
      favorites = msg.favorites;
      updatePluginData();
      updateUI();
      break;
    // ... any additional message handling ...
  }
};

// Command handling
if (figma.command === "openFrameHop") {
  figma.showUI(__html__, { width: 240, height: 360 });
  loadPluginData();
  updateUI();
} else if (
  figma.command === "hopBackwards" ||
  figma.command === "hopForwards"
) {
  figma.showUI(__html__, { width: 240, height: 360 });
  loadPluginData();
  if (figma.command === "hopBackwards") {
    hopBackwards();
  } else if (figma.command === "hopForwards") {
    hopForwards();
  }
}

// Selection Change Event Listener and Initial UI Update
figma.on("selectionchange", updateHistory);

// Ensure the UI is updated with current frame selection
if (figma.currentPage.selection.length > 0) {
  updateHistory();
}
updateUI();
