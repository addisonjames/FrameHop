let history = [];
let currentIndex = -1;
let favorites = [];

function updatePluginData() {
  const data = { history, currentIndex, favorites };
  figma.root.setPluginData('frameHopData', JSON.stringify(data));
}

function loadPluginData() {
  const data = figma.root.getPluginData('frameHopData');
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
}

function updateUI() {
  const recentHistory = history
    .slice(-16)
    .reverse()
    .map((item) => {
      const node = figma.getNodeById(item.frameId);
      const page = node ? figma.getNodeById(item.pageId) : null;
      return node && page
        ? {
            id: node.id,
            name: node.name || (node.type === 'SECTION' ? 'Section' : 'Unnamed'),
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
    type: 'update',
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
    console.log('Jumped to Frame:', frameId, 'on Page:', targetPage.name);
  } else {
    console.log('Frame not found:', frameId);
  }
  updateUI();
}

function updateHistory() {
  const currentSelection = figma.currentPage.selection;
  if (currentSelection.length > 0) {
    const selectedItem = currentSelection[0];
    const itemType = selectedItem.type;
    if (
      itemType === 'FRAME' ||
      itemType === 'COMPONENT' ||
      itemType === 'COMPONENT_SET' ||
      itemType === 'SECTION'
    ) {
      const itemId = selectedItem.id;
      const pageId = selectedItem.parent.id;
      const isSection = itemType === 'SECTION';
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
      console.log('updateHistory - currentIndex:', currentIndex);
      updatePluginData();
    }
  }
  updateUI();
}

figma.ui.onmessage = (msg) => {
  switch (msg.type) {
    case 'jumpToFrame':
      jumpToFrame(msg.frameId);
      break;
    case 'clearData':
      history = [];
      currentIndex = -1;
      favorites = [];
      updatePluginData();
      updateUI();
      break;
    case 'updateFavorites':
      favorites = msg.favorites.map((fav) => ({
        id: fav.id,
        name: fav.name,
        pageId: fav.pageId,
        pageName: fav.pageName,
        isSection: fav.isSection, // Ensuring isSection is preserved
      }));
      updatePluginData();
      updateUI();
      break;
  }
};

if (figma.command === 'openFrameHop') {
  figma.showUI(__html__, { width: 240, height: 360 });
  loadPluginData();
  updateUI();
} else if (
  figma.command === 'hopBackwards' ||
  figma.command === 'hopForwards'
) {
  figma.showUI(__html__, { width: 240, height: 360 });
  loadPluginData();
  if (figma.command === 'hopBackwards') {
    hopBackwards();
  } else if (figma.command === 'hopForwards') {
    hopForwards();
  }
}

figma.on('selectionchange', updateHistory);
if (figma.currentPage.selection.length > 0) {
  updateHistory();
}
updateUI();
