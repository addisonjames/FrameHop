let history = [];
let currentIndex = -1;
let favorites = [];
let showPageName = true; // Control the display of the page name
let historyLength = 8; // Default history length
let currentFavoriteIndex = -1;
let currentTheme = "dark"; // Default theme

// Set relaunch data with a descriptive string for the relaunch button
figma.root.setRelaunchData({ openFrameHop: "" });

// Check if the editor type is FigJam, and adjust settings accordingly
if (figma.editorType === "figjam") {
  showPageName = false; // Turn off the "Show Page Names" setting in FigJam
  currentTheme = "light"; // Change theme to Light in Figjam by default
}

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
  // Also send the editorType to the UI to adjust visibility of elements
  figma.ui.postMessage({
    type: "loadSettings",
    showPageName: showPageName,
    historyLength: historyLength,
    editorType: figma.editorType,
    theme: currentTheme,
  });
}

function updateUI() {
  // This variable will hold the ID of the currently selected frame, if any
  const currentSelectionId =
    figma.currentPage.selection.length > 0
      ? figma.currentPage.selection[0].id
      : null;

  // Update currentFavoriteIndex based on the current selection
  currentFavoriteIndex = favorites.findIndex(
    (fav) => fav.id === currentSelectionId
  );

  favorites = favorites
    .map((fav) => {
      const node = figma.getNodeById(fav.id);
      if (node) {
        // Update the favorite with the latest name from the Figma document
        return {
          id: fav.id,
          name: node.name,
          isSection: fav.isSection,
        };
      } else {
        // If the node is not found, return null to filter it out
        return null;
      }
    })
    .filter((fav) => fav !== null); // Filter out any favorites that might have been deleted

  // Slice the history to respect the historyLength setting
  const limitedHistory = history.slice(-historyLength);

  // Reverse the history for display purposes
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
            isSection: item.isSection || false,
            // Only include pageName if not in FigJam
            pageName:
              figma.editorType === "figma" && showPageName ? page.name : "",
          }
        : null;
    })
    .filter((node) => node !== null);

  // Send the updated information to the UI
  figma.ui.postMessage({
    type: "update",
    historyData: recentHistory,
    currentFrameId: currentSelectionId,
    currentPageId: figma.currentPage.id,
    favorites: favorites, // Send the updated favorites array
    currentFavoriteIndex,
    showPageName,
  });

  console.log("updateUI - Recent history for UI:", recentHistory);
  console.log("updateUI - Updated favorites:", favorites); // Additional log for debugging
}

function jumpToFrame(frameId) {
  const targetFrame = figma.getNodeById(frameId);

  if (targetFrame) {
    let targetPage = targetFrame.parent;
    // Traverse up the node hierarchy until we find a page.
    while (targetPage && targetPage.type !== "PAGE") {
      targetPage = targetPage.parent;
    }

    if (targetPage) {
      figma.currentPage = targetPage;
      figma.currentPage.selection = [targetFrame];
      figma.viewport.scrollAndZoomIntoView([targetFrame]);

      // Update currentIndex and currentFavoriteIndex
      currentIndex = history.findIndex((item) => item.frameId === frameId);
      currentFavoriteIndex = favorites.findIndex((item) => item.id === frameId);

      console.log("Jumped to Frame:", frameId, "on Page:", targetPage.name);
    } else {
      console.log("Page not found for frame:", frameId);
    }
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

  if (history.length > historyLength) {
    history = history.slice(-historyLength);
    currentIndex = Math.min(currentIndex, history.length - 1); // Ensure currentIndex isn't out of bounds
  }

  updatePluginData(); // Save the updated history length setting
  updateUI(); // Reflect changes in the UI

  // Send a message to the UI to update the history length display
  figma.ui.postMessage({
    type: "updateHistoryLengthDisplay",
    historyLength: historyLength,
  });
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
    case "updateTheme":
      // Update the current theme based on the message from the UI
      currentTheme = msg.theme;
      // Apply the theme to the UI if necessary
      figma.ui.postMessage({ type: "applyTheme", theme: currentTheme });
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
