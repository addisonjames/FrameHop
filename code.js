let history = [];
let currentIndex = -1;
let favorites = [];
let isReorderHistoryEnabled = true; // Control whether the history is reordered or not // This can be toggled by the user
let fromUI = false; // Flag to check if the action is coming from the UI

function updatePluginData() {
  const data = { history, currentIndex, favorites };
  figma.root.setPluginData("frameHopData", JSON.stringify(data));
}

function loadPluginData() {
  const data = figma.root.getPluginData("frameHopData");
  // Debug logs to check what data is being loaded
  console.log("loadPluginData - Loaded data:", data);

  if (data) {
    const parsedData = JSON.parse(data);
    history = parsedData.history || [];
    currentIndex = parsedData.currentIndex || -1;
    favorites = parsedData.favorites || [];
  } else {
    history = [];
    currentIndex = -1;
    favorites = [];
  }
  updateUI();
}

function updateUI() {
  let recentHistory;

  // Check if history should be reordered and the action didn't come from the UI
  if (isReorderHistoryEnabled && !fromUI) {
    recentHistory = history.slice(0, 16);
  } else {
    // If fromUI is true or reordering is disabled, keep the order as is
    recentHistory = history.slice(-16).reverse();
  }

  recentHistory = recentHistory
    .map((item) => {
      const node = figma.getNodeById(item.frameId);
      const page = node ? figma.getNodeById(item.pageId) : null;
      return node && page
        ? {
            id: node.id,
            name:
              node.name || (node.type === "SECTION" ? "Section" : "Unnamed"),
            pageId: page.id,
            pageName: page.name,
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
  let targetPage = null;
  let targetFrame = null;

  // Search for the frame by ID
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
    console.log("Jumped to Frame:", frameId, "on Page:", targetPage.name);
  } else {
    console.log("Frame not found:", frameId);
  }
}

// Function to update the history from the UI
// This is where the flag check should happen to prevent reordering
function updateHistoryFromUI(frameId) {
  // Check if the item is in the history
  const itemIndex = history.findIndex((item) => item.frameId === frameId);

  if (itemIndex >= 0) {
    // Move the item to the top if reordering is enabled
    if (isReorderHistoryEnabled) {
      const [item] = history.splice(itemIndex, 1); // Remove the item
      history.unshift(item); // Add it to the beginning
      currentIndex = 0; // The item is now the first one
    } else {
      // Just update the current index
      currentIndex = itemIndex;
    }
  }

  // Ensure UI updates without reordering
  fromUI = true;
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
      itemType === "COMPONENT_SET" ||
      itemType === "SECTION"
    ) {
      const itemId = selectedItem.id;
      const pageId = selectedItem.parent.id;
      const isSection = itemType === "SECTION";
      const item = { frameId: itemId, pageId: pageId, isSection: isSection };

      if (!fromUI && isReorderHistoryEnabled) {
        history = history.filter(
          (h) => h.frameId !== itemId || h.pageId !== pageId
        );
        history.unshift(item);
        currentIndex = 0;
      } else if (!fromUI && !isReorderHistoryEnabled) {
        if (!history.some((h) => h.frameId === itemId)) {
          history.push(item);
        }
        currentIndex = history.length - 1;
      } else {
        // If fromUI is true, only update the currentIndex without reordering.
        const existingIndex = history.findIndex((h) => h.frameId === itemId);
        if (existingIndex !== -1) {
          currentIndex = existingIndex;
        }
      }

      console.log(
        "updateHistory - currentIndex:",
        currentIndex,
        "history updated:",
        history
      );
      updatePluginData();
    }
  }
}

figma.on("selectionchange", () => {
  fromUI = false; // Ensure the flag is reset on every selection change
  updateHistory();
});

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

// Message handling from the UI
figma.ui.onmessage = (msg) => {
  switch (msg.type) {
    case "jumpToFrameFromUI":
      // Indicate that jump is triggered from the UI
      fromUI = true;
      // Perform the jump to the frame without updating history
      jumpToFrame(msg.frameId);
      // The flag will be reset within the jumpToFrame function
      break;
    case "jumpToFrame":
      // Perform the jump to the frame and allow history update
      jumpToFrame(msg.frameId, true);
      break;
    case "clearData":
      // Clear history, currentIndex, and favorites
      history = [];
      currentIndex = -1;
      favorites = [];
      // Update the plugin data in storage
      figma.root.setPluginData('frameHopData', JSON.stringify({ history, currentIndex, favorites }));
      // Update the UI to reflect these changes
      updateUI();
      break;
    case "updateFavorites":
      // Map the favorites from the message to the favorites in the plugin
      favorites = msg.favorites.map((fav) => ({
        id: fav.id,
        name: fav.name,
        pageId: fav.pageId,
        pageName: fav.pageName,
        isSection: fav.isSection,
      }));
      // Update the plugin data with the new favorites
      updatePluginData();
      // Update the UI with the new favorites
      updateUI();
      break;
    // Add any additional cases if needed in the future
  }
};

// Listener for selection changes in the Figma canvas
figma.on("selectionchange", () => {
  // If the selection change is not from UI, update history
  if (!fromUI) {
    updateHistory();
  }
});

// Command handling for when the plugin is opened or a quick action is triggered
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
  // Perform hop backwards or forwards based on the command
  if (figma.command === "hopBackwards") {
    hopBackwards();
  } else if (figma.command === "hopForwards") {
    hopForwards();
  }
}

// When the plugin starts, load the existing data and update the UI
if (figma.currentPage.selection.length > 0) {
  updateHistory();
}
updateUI();
