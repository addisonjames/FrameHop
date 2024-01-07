let history = [];
let currentIndex = -1;
let favorites = [];
let showPageName = true; // Control the display of the page name
let historyLength = 16; // Default history length

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
  const recentHistory = history
    .slice(-historyLength)
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
            pageName: showPageName ? page.name : "", // Conditionally display the page name
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

      const itemIndex = history.findIndex(
        (h) => h.frameId === itemId && h.pageId === pageId
      );
      if (itemIndex === -1) {
        history.push(item);
        currentIndex = history.length - 1;
      } else {
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

// New function to handle the cycling of history length
function cycleHistoryLength() {
  const lengths = [4, 8, 16, 20]; // Possible history lengths
  let currentIndex = lengths.indexOf(historyLength); // Find the current index
  historyLength = lengths[(currentIndex + 1) % lengths.length]; // Cycle to the next length
  updatePluginData(); // Save the updated history length
  updateUI(); // Update the UI with the new history length
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
      figma.root.setPluginData(
        "frameHopData",
        JSON.stringify({ history, currentIndex, favorites })
      );
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
      updatePluginData(); // Save the updated showPageName state
      figma.ui.postMessage({
        // Notify the UI to update the frame list
        type: "toggleShowPageName",
        value: showPageName,
      });
      updateUI(); // Refresh the UI with the new state
      break;
    case "cycleHistoryLength":
      cycleHistoryLength(); // Call the function when the message is received
      figma.ui.postMessage({
        // Notify the UI to update the history length display
        type: "updateHistoryLengthDisplay",
        historyLength: historyLength,
      });
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

// Ensure the UI is updated with current frame selection
figma.on("selectionchange", updateHistory);
if (figma.currentPage.selection.length > 0) {
  updateHistory();
}
updateUI();
