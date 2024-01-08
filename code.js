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
  console.log("loadPluginData - Loaded data:", data);

  if (data) {
    const parsedData = JSON.parse(data);
    history = parsedData.history.slice(-historyLength) || []; // Truncate the history right after loading it
    currentIndex = parsedData.currentIndex || -1;
    favorites = parsedData.favorites || [];
  } else {
    history = [];
    currentIndex = -1;
    favorites = [];
  }
  console.log("History after loading data:", history); // Console log for debugging
  updateUI();

  // Restore window size
  figma.clientStorage.getAsync("frameHopWindowSize").then((size) => {
    if (size) {
      figma.ui.resize(size.width, size.height);
    }
  });
}

function updateUI() {
  // Ensure the history array does not exceed the set history length
  history = history.slice(-historyLength);

  // Reverse the history for display to show the most recent items first
  const recentHistory = history.slice().reverse().map((item) => {
    const node = figma.getNodeById(item.frameId);
    const page = node ? figma.getNodeById(item.pageId) : null;
    return node && page
      ? {
          id: node.id,
          name: node.name || (node.type === "SECTION" ? "Section" : "Unnamed"),
          pageId: page.id,
          pageName: showPageName ? page.name : "",
          isSection: item.isSection || false,
        }
      : null;
  }).filter((node) => node !== null);

  const currentFrameId =
    figma.currentPage.selection.length > 0
      ? figma.currentPage.selection[0].id
      : null;

  const currentPageId = figma.currentPage.id;

  console.log("updateUI - Recent history for UI:", recentHistory);

  // Post the updated recent history and other details to the UI
  figma.ui.postMessage({
    type: "update",
    historyData: recentHistory,
    currentFrameId,
    currentPageId,
    favorites,
  });
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
    currentIndex = history.findIndex(item => item.frameId === frameId);

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

function cycleHistoryLength() {
  const lengths = [4, 8, 16, 20];
  let currentLengthIndex = lengths.indexOf(historyLength);
  historyLength = lengths[(currentLengthIndex + 1) % lengths.length];

  // Keep the most recent frames, which we assume to be at the beginning of the array
  if (history.length > historyLength) {
    history = history.slice(0, historyLength); // Slice from the start to keep the newest
  }

  updatePluginData(); // Save the updated history and history length
  updateUI(); // Update the UI with the new history
}


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
      updatePluginData();
      figma.ui.postMessage({
        type: "toggleShowPageName",
        value: showPageName,
      });
      updateUI();
      break;
    case "cycleHistoryLength":
      cycleHistoryLength();
      figma.ui.postMessage({
        type: "updateHistoryLengthDisplay",
        historyLength: historyLength,
      });
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