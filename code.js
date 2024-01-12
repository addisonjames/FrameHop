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
      theme: currentTheme,
    },
  };
  console.log("Saving updated plugin data with history length:", historyLength); // Debug log
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
      currentTheme = parsedData.settings.theme || currentTheme; // Add this line
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
    editorType: figma.editorType,
    theme: currentTheme, // Added when trying to get Figjam theme to default to light but didn't work
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
            pageName: showPageName ? page.name : "",
            type: node.type, // Add the type of the node here
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
    currentFavoriteIndex: currentFavoriteIndex,
    showPageName: showPageName,
    historyLength: historyLength,
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
    console.log("Selected item type:", selectedItem.type); // Log the type of the selected item
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
  if (currentIndex < history.length - 1) {
    currentIndex += 1;
    jumpToFrame(history[currentIndex].frameId);
    updatePluginData();
    updateUI(); // Call updateUI to ensure UI is updated with current settings
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
  if (currentIndex > 0) {
    currentIndex -= 1;
    jumpToFrame(history[currentIndex].frameId);
    updatePluginData();
    updateUI(); // Call updateUI to ensure UI is updated with current settings
    console.log("After Hop Backwards: currentIndex =", currentIndex);
  }
}

function cycleHistoryLength() {
  const lengths = [4, 8, 16];
  let currentLengthIndex = lengths.indexOf(historyLength);
  historyLength = lengths[(currentLengthIndex + 1) % lengths.length];
  console.log("Cycled history length to:", historyLength); // Debug log

  // Save the current frame ID and favorite ID
  const currentFrameId = history[currentIndex]
    ? history[currentIndex].frameId
    : null;
  const currentFavoriteId = favorites[currentFavoriteIndex]
    ? favorites[currentFavoriteIndex].id
    : null;

  if (history.length > historyLength) {
    history = history.slice(-historyLength);
  }

  // Re-identify the currentIndex and currentFavoriteIndex based on the saved IDs
  currentIndex = history.findIndex((item) => item.frameId === currentFrameId);
  currentFavoriteIndex = favorites.findIndex(
    (fav) => fav.id === currentFavoriteId
  );

  // Ensure currentIndex and currentFavoriteIndex aren't out of bounds
  currentIndex = Math.max(currentIndex, -1);
  currentFavoriteIndex = Math.max(currentFavoriteIndex, -1);

  updatePluginData(); // Save the updated history length setting
  updateUI(); // Reflect changes in the UI
  console.log("Updated plugin data and UI after cycling history length"); // Debug log

  // Send a message to the UI to update the history length display
  figma.ui.postMessage({
    type: "updateHistoryLengthDisplay",
    historyLength: historyLength,
    // Include the currentFrameId and currentFavoriteIndex to maintain the selection
    currentFrameId: currentFrameId,
    currentFavoriteIndex: currentFavoriteIndex,
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

    case "updateFavoritesOrder":
      favorites = msg.favorites;
      updatePluginData();
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

      // Save the updated theme setting
      updatePluginData();

      // Apply the theme to the UI if necessary
      figma.ui.postMessage({ type: "applyTheme", theme: currentTheme });
      break;
  }
};

// Command handlindocument.getElementById("toggleTheme").addEventListenerg
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
