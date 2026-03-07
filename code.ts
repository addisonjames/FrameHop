let history: { frameId: string; pageId: string; isSection: boolean }[] = [];
let currentIndex = -1;
let favorites: { id: string; name: string; isSection?: boolean; pageId?: string; pageName?: string }[] = [];
let showPageName = true; // Control the display of the page name
let historyLength = 8; // Default history length
let currentFavoriteIndex = -1;
let currentTheme = "dark"; // Default theme
let isNavigating = false; // Suppress updateHistory during programmatic navigation

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
      showPageName: showPageName,
      historyLength: historyLength,
      theme: currentTheme,
    },
  };
  console.log("Saving updated plugin data with history length:", historyLength);
  figma.root.setPluginData("frameHopData", JSON.stringify(data));
}

async function loadPluginData() {
  const data = figma.root.getPluginData("frameHopData");
  console.log("loadPluginData - Loaded data:", data);

  if (data) {
    const parsedData = JSON.parse(data);
    history = parsedData.history || [];
    currentIndex = parsedData.currentIndex !== undefined ? parsedData.currentIndex : -1;
    favorites = parsedData.favorites || [];

    // Load and apply settings
    if (parsedData.settings) {
      showPageName =
        parsedData.settings.showPageName !== undefined
          ? parsedData.settings.showPageName
          : showPageName;
      historyLength = parsedData.settings.historyLength || historyLength;
      currentTheme = parsedData.settings.theme || currentTheme;
    }
  } else {
    history = [];
    currentIndex = -1;
    favorites = [];
  }
  console.log(
    "History and Settings after loading data:",
    history,
    showPageName,
    historyLength
  );

  // Restore window size
  figma.clientStorage.getAsync("frameHopWindowSize").then((size: any) => {
    if (size) {
      figma.ui.resize(size.width, size.height);
    }
  });

  await updateUI();
  // Send the initial settings to the UI when the plugin is reloaded
  figma.ui.postMessage({
    type: "loadSettings",
    showPageName: showPageName,
    historyLength: historyLength,
    editorType: figma.editorType,
    theme: currentTheme,
  });
}

async function updateUI() {
  // This variable will hold the ID of the currently selected frame, if any
  const currentSelectionId =
    figma.currentPage.selection.length > 0
      ? figma.currentPage.selection[0].id
      : null;

  // Update currentFavoriteIndex based on the current selection
  currentFavoriteIndex = favorites.findIndex(
    (fav) => fav.id === currentSelectionId
  );

  // Update favorites with async node lookups
  const updatedFavorites: typeof favorites = [];
  for (const fav of favorites) {
    const node = await figma.getNodeByIdAsync(fav.id);
    if (node) {
      updatedFavorites.push({
        id: fav.id,
        name: node.name,
        isSection: fav.isSection,
      });
    }
  }
  favorites = updatedFavorites;

  // Slice the history to respect the historyLength setting
  const limitedHistory = history.slice(-historyLength);

  // Reverse the history for display purposes
  const reversedHistory = limitedHistory.reverse();
  const recentHistory: any[] = [];
  for (const item of reversedHistory) {
    const node = await figma.getNodeByIdAsync(item.frameId);
    const page = node ? await figma.getNodeByIdAsync(item.pageId) : null;
    if (node && page) {
      recentHistory.push({
        id: node.id,
        name: node.name || (node.type === "SECTION" ? "Section" : "Unnamed"),
        pageId: page.id,
        type: node.type,
        isSection: item.isSection || false,
        pageName:
          figma.editorType === "figma" && showPageName ? (page as PageNode).name : "",
      });
    }
  }

  // Send the updated information to the UI
  figma.ui.postMessage({
    type: "update",
    historyData: recentHistory,
    currentFrameId: currentSelectionId,
    currentPageId: figma.currentPage.id,
    favorites: favorites,
    currentFavoriteIndex: currentFavoriteIndex,
    showPageName: showPageName,
    historyLength: historyLength,
  });

  console.log("updateUI - Recent history for UI:", recentHistory);
  console.log("updateUI - Updated favorites:", favorites);
}

async function jumpToFrame(frameId: string) {
  const targetFrame = await figma.getNodeByIdAsync(frameId);

  if (targetFrame) {
    let targetPage: BaseNode | null = targetFrame.parent;
    // Traverse up the node hierarchy until we find a page.
    while (targetPage && targetPage.type !== "PAGE") {
      targetPage = targetPage.parent;
    }

    if (targetPage) {
      isNavigating = true;
      await figma.setCurrentPageAsync(targetPage as PageNode);
      figma.currentPage.selection = [targetFrame as SceneNode];
      figma.viewport.scrollAndZoomIntoView([targetFrame as SceneNode]);
      isNavigating = false;

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
  await updateUI();
}

async function updateHistory() {
  const currentSelection = figma.currentPage.selection;
  if (currentSelection.length > 0) {
    const selectedItem = currentSelection[0];
    console.log("Selected item type:", selectedItem.type);
    const itemType = selectedItem.type;
    if (
      itemType === "FRAME" ||
      itemType === "COMPONENT" ||
      itemType === "COMPONENT_SET" ||
      itemType === "SECTION"
    ) {
      const itemId = selectedItem.id;
      const pageId = selectedItem.parent!.id;
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
      await updateUI();
    }
  } else {
    // Reset currentIndex if nothing is selected
    currentIndex = history.length > 0 ? history.length - 1 : -1;
    updatePluginData();
    await updateUI();
  }
}

figma.on("selectionchange", () => {
  if (!isNavigating) {
    updateHistory();
  }
});

// Handle hopping forwards in history
async function hopForwards() {
  console.log(
    "Before Hop Forwards: currentIndex =",
    currentIndex,
    ", history =",
    history
  );
  if (currentIndex < history.length - 1) {
    currentIndex += 1;
    await jumpToFrame(history[currentIndex].frameId);
    updatePluginData();
    await updateUI();
    console.log("After Hop Forwards: currentIndex =", currentIndex);
  }
}

// Handle hopping backwards in history
async function hopBackwards() {
  console.log(
    "Before Hop Backwards: currentIndex =",
    currentIndex,
    ", history =",
    history
  );
  if (currentIndex > 0) {
    currentIndex -= 1;
    await jumpToFrame(history[currentIndex].frameId);
    updatePluginData();
    await updateUI();
    console.log("After Hop Backwards: currentIndex =", currentIndex);
  }
}

async function cycleHistoryLength() {
  const lengths = [4, 8, 16];
  let currentLengthIndex = lengths.indexOf(historyLength);
  historyLength = lengths[(currentLengthIndex + 1) % lengths.length];
  console.log("Cycled history length to:", historyLength);

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

  updatePluginData();
  await updateUI();
  console.log("Updated plugin data and UI after cycling history length");

  // Send a message to the UI to update the history length display
  figma.ui.postMessage({
    type: "updateHistoryLengthDisplay",
    historyLength: historyLength,
    currentFrameId: currentFrameId,
    currentFavoriteIndex: currentFavoriteIndex,
  });
}

figma.ui.onmessage = async (msg: any) => {
  switch (msg.type) {
    case "jumpToFrame":
      await jumpToFrame(msg.frameId);
      break;

    case "clearData":
      history = [];
      currentIndex = -1;
      favorites = [];
      currentFavoriteIndex = -1;
      figma.root.setPluginData("frameHopData", JSON.stringify({}));
      figma.ui.postMessage({ type: "dataCleared" });
      await updateUI();
      break;

    case "updateFavorites":
      favorites = msg.favorites.map((fav: any) => ({
        id: fav.id,
        name: fav.name,
        pageId: fav.pageId,
        pageName: fav.pageName,
        isSection: fav.isSection,
      }));
      updatePluginData();
      await updateUI();
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
      await updateUI();
      break;

    case "cycleHistoryLength":
      await cycleHistoryLength();
      break;

    case "resize":
      const { width, height } = msg;
      figma.ui.resize(width, height);
      figma.clientStorage.setAsync("frameHopWindowSize", { width, height });
      break;

    case "updateTheme":
      currentTheme = msg.theme;
      updatePluginData();
      figma.ui.postMessage({ type: "applyTheme", theme: currentTheme });
      break;
  }
};

// Command handling
if (figma.command === "openFrameHop") {
  figma.showUI(__html__, { width: 240, height: 360 });
  loadPluginData();
} else if (
  figma.command === "hopBackwards" ||
  figma.command === "hopForwards"
) {
  figma.showUI(__html__, { width: 240, height: 360 });
  loadPluginData().then(async () => {
    if (figma.command === "hopBackwards") {
      await hopBackwards();
    } else if (figma.command === "hopForwards") {
      await hopForwards();
    }
  });
}

if (figma.currentPage.selection.length > 0) {
  updateHistory();
}
