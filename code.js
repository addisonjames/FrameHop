let history = [];
let currentIndex = -1;
let favorites = [];
let showPageName = true; // Control the display of the page name
let historyLength = 8; // Default history length
let currentFavoriteIndex = -1;

function updatePluginData() {
  const data = {
    history,
    currentIndex,
    favorites,
    settings: {
      // Include the settings in the data object
      showPageName: showPageName,
      historyLength: historyLength,
    },
  };
  figma.root.setPluginData("frameHopData", JSON.stringify(data));
}

function loadPluginData() {
  const data = figma.root.getPluginData("frameHopData");
  console.log("loadPluginData - Loaded data:", data);

  if (data) {
    const parsedData = JSON.parse(data);
    history = parsedData.history || [];
    currentIndex = parsedData.currentIndex || -1;
    favorites = parsedData.favorites || [];

    // Load and apply settings
    if (parsedData.settings) {
      showPageName =
        parsedData.settings.showPageName !== undefined
          ? parsedData.settings.showPageName
          : showPageName;
      historyLength = parsedData.settings.historyLength || historyLength;
    }
  } else {
    history = [];
    currentIndex = -1;
    favorites = [];
    // Default settings can be set here if needed
  }
  console.log(
    "History and Settings after loading data:",
    history,
    showPageName,
    historyLength
  ); // Console log for debugging

  // Restore window size
  figma.clientStorage.getAsync("frameHopWindowSize").then((size) => {
    if (size) {
      figma.ui.resize(size.width, size.height);
    }
  });

  updateUI();
  // Send the initial settings to the UI when the plugin is reloaded
  figma.ui.postMessage({
    type: "loadSettings",
    showPageName: showPageName,
    historyLength: historyLength,
  });
}

function updateUI() {
  // Slice the history array to respect the historyLength setting
  const limitedHistory = history.slice(-historyLength);

  // Reverse the history for display to show the most recent items first
  const recentHistory = limitedHistory
    .reverse()
    .map((item) => {
      const node = figma.getNodeById(item.frameId);
      const page = node ? figma.getNodeById(item.pageId) : null;
      return node && page
        ? {
            id: node.id,
            name:
              node.name || (node.type === "SECTION" ? "Section" : "Unnamed"),
            pageId: page.id,
            pageName: showPageName ? page.name : "",
            isSection: item.isSection || false,
          }
        : null;
    })
    .filter((node) => node !== null);

  const currentFrameId =
    figma.currentPage.selection.length > 0
      ? figma.currentPage.selection[0].id
      : null;

  const currentPageId = figma.currentPage.id;

  console.log("updateUI - Recent history for UI:", recentHistory);
  // Check if data is cleared and send a message to the UI to reset if needed
  if (history.length === 0 && currentIndex === -1 && favorites.length === 0) {
    figma.ui.postMessage({
      type: "dataCleared"
    });
  } else {
  // Post the updated recent history and other details to the UI
  figma.ui.postMessage({
    type: "update",
    historyData: recentHistory,
    currentFrameId,
    currentPageId,
    favorites,
    currentFavoriteIndex: currentFavoriteIndex,
    showPageName: showPageName,
  });
}
}

function jumpToFrame(frameId) {
  let targetPage = null;
  let targetFrame = null;

  figma.root.children.forEach((page) => {
    const frame = page.findOne((node) => node.id === frameId);
    if (frame) {
      targetPage = page;
      targetFrame = frame;
    }
  });

  if (targetPage && targetFrame) {
    figma.currentPage = targetPage;
    figma.currentPage.selection = [targetFrame];
    figma.viewport.scrollAndZoomIntoView([targetFrame]);

    // Update currentIndex to the index of the frame that was just selected
    currentIndex = history.findIndex((item) => item.frameId === frameId);

    // Update currentFavoriteIndex for the selected frame
    currentFavoriteIndex = favorites.findIndex((item) => item.id === frameId);

    console.log("Jumped to Frame:", frameId, "on Page:", targetPage.name);
  } else {
    console.log("Frame not found:", frameId);
  }
  updateUI();
}

function updateHistory() {
  const currentSelection = figma.currentPage.selection;
  if (currentSelection.length > 0) {
    const selectedItem = currentSelection[0];
    const itemType = selectedItem.type;
    if (
      itemType === "FRAME" ||
      itemType === "COMPONENT" ||
      itemType === "COMPONENT_SET" ||
      itemType === "SECTION"
    ) {
      const itemId = selectedItem.id;
      const pageId = selectedItem.parent.id;
      const isSection = itemType === "SECTION";
      const item = { frameId: itemId, pageId: pageId, isSection: isSection };

      const itemIndex = history.findIndex(
        (h) => h.frameId === itemId && h.pageId === pageId
      );
      if (itemIndex === -1) {
        // Add new item and slice the history if it exceeds historyLength
        history.push(item);
        if (history.length > historyLength) {
          history = history.slice(-historyLength);
        }
        currentIndex = history.length - 1;
      } else {
        // If the item is already in the history, update currentIndex without reordering
        currentIndex = itemIndex;
      }
      updatePluginData();
      updateUI();
    }
  } else {
    // Reset currentIndex if nothing is selected
    currentIndex = history.length > 0 ? history.length - 1 : -1;
    updatePluginData();
    updateUI();
  }
}

figma.on("selectionchange", updateHistory);

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
    jumpToFrame(history[currentIndex].frameId);
    updatePluginData();
    console.log("After Hop Forwards: currentIndex =", currentIndex);
  }
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
    jumpToFrame(history[currentIndex].frameId);
    updatePluginData();
    console.log("After Hop Backwards: currentIndex =", currentIndex);
  }
}

function cycleHistoryLength() {
  const lengths = [4, 8, 16];
  let currentLengthIndex = lengths.indexOf(historyLength);
  historyLength = lengths[(currentLengthIndex + 1) % lengths.length];

  // Determine the frame to highlight after cycling history length
  let frameToHighlight = currentIndex < history.length ? history[currentIndex] : null;

  if (history.length > historyLength) {
    history = history.slice(-historyLength);
    // Update currentIndex to the new index of the frame to highlight
    currentIndex = history.findIndex(item => frameToHighlight && item.frameId === frameToHighlight.frameId);
    if(currentIndex === -1 && frameToHighlight) {
      currentIndex = history.length - 1; // If not found, set to the last item.
    }
  }

  currentFavoriteIndex = favorites.findIndex(fav => frameToHighlight && fav.id === frameToHighlight.frameId);

  updatePluginData(); // Save the updated history length setting
  updateUI(); // Reflect changes in the UI

  // Send a message to the UI to update the history length display and maintain highlighting
  figma.ui.postMessage({
    type: "updateHistoryLengthDisplay",
    historyLength: historyLength,
    currentFrameId: frameToHighlight ? frameToHighlight.frameId : null,
    currentFavoriteIndex: currentFavoriteIndex
  });

  console.log(`Cycle History Length: New length is ${historyLength}, current index is ${currentIndex}`);
}

figma.ui.onmessage = (msg) => {
  switch (msg.type) {
    case "jumpToFrame":
      jumpToFrame(msg.frameId);
      break;
    case "clearData":
      // Reset the data
      history = [];
      currentIndex = -1;
      favorites = [];
      currentFavoriteIndex = -1; // Ensure this is also reset
      // Clear plugin data from Figma's storage
      figma.root.setPluginData("frameHopData", JSON.stringify({}));
      // Inform the UI to clear its state
      figma.ui.postMessage({ type: "dataCleared" });
      updateUI();
      break;
    case "updateFavorites":
      favorites = msg.favorites.map((fav) => ({
        id: fav.id,
        name: fav.name,
        pageId: fav.pageId,
        pageName: fav.pageName,
        isSection: fav.isSection,
      }));
      updatePluginData();
      updateUI();
      break;
    case "togglePageName":
      showPageName = msg.value;
      updatePluginData();
      figma.ui.postMessage({
        type: "showPageNameUpdated",
        showPageName: showPageName,
      });
      updateUI();
      break;
    case "cycleHistoryLength":
      cycleHistoryLength(); // This function now should call updatePluginData internally
      break;
    case "resize":
      const { width, height } = msg;
      figma.ui.resize(width, height);
      figma.clientStorage.setAsync("frameHopWindowSize", { width, height });
      break;
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

figma.on("selectionchange", updateHistory);
if (figma.currentPage.selection.length > 0) {
  updateHistory();
}
updateUI();