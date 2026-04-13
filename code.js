"use strict";
/// <reference path="./node_modules/@figma/plugin-typings/index.d.ts" />
let history = [];
let currentIndex = -1;
let favorites = [];
let showPageName = false; // Control the display of the page name
let pageNamesAutoEnabled = false; // True once page names were auto-enabled; prevents repeat auto-enable
let historyLength = 8; // Default history length
let currentFavoriteIndex = -1;
let currentTheme = "system"; // Default theme (follows OS appearance)
const trackAllObjects = true; // Always track all SceneNode types
let autoResize = true; // When true, the plugin window auto-fits its content height
let currentWindowWidth = 252; // Tracked so auto-resize can adjust height without changing width
let currentWindowHeight = 360; // Tracked so we can persist the latest applied size
// Floor at 316px so the settings popover is fully visible even when the
// favorites and history lists are empty.
const AUTO_RESIZE_MIN_HEIGHT = 316;
// Max height scales with the history-length setting so the cap is generous
// for 16 items but tight for 8. ~25px per history slot on top of the base UI.
const AUTO_RESIZE_BASE_HEIGHT = 200;
const AUTO_RESIZE_PER_ITEM = 25;
function computeAutoResizeMaxHeight() {
    return AUTO_RESIZE_BASE_HEIGHT + historyLength * AUTO_RESIZE_PER_ITEM;
}
let isNavigating = false; // Suppress updateHistory during programmatic navigation
let isHopping = false; // Suppress updateHistory during hop command startup
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
            pageNamesAutoEnabled: pageNamesAutoEnabled,
            historyLength: historyLength,
            theme: currentTheme,
            trackAllObjects: trackAllObjects,
            autoResize: autoResize,
        },
    };
    console.log("Saving updated plugin data with history length:", historyLength);
    figma.root.setPluginData("frameHopData", JSON.stringify(data));
}
// Auto-enable page names the first time history spans multiple pages.
function maybeAutoEnablePageNames() {
    if (showPageName || pageNamesAutoEnabled)
        return;
    const uniquePages = new Set(history.map((h) => h.pageId));
    if (uniquePages.size > 1) {
        showPageName = true;
        pageNamesAutoEnabled = true;
        updatePluginData();
        figma.ui.postMessage({
            type: "showPageNameUpdated",
            showPageName: true,
        });
    }
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
            pageNamesAutoEnabled =
                parsedData.settings.pageNamesAutoEnabled !== undefined
                    ? parsedData.settings.pageNamesAutoEnabled
                    : pageNamesAutoEnabled;
            historyLength = parsedData.settings.historyLength || historyLength;
            // Migrate old "4" history length to 8 (4 was removed as an option).
            if (historyLength === 4)
                historyLength = 8;
            currentTheme = parsedData.settings.theme || currentTheme;
            // trackAllObjects is now permanently true — skip loading the old setting.
            autoResize =
                parsedData.settings.autoResize !== undefined
                    ? parsedData.settings.autoResize
                    : true;
        }
    }
    else {
        history = [];
        currentIndex = -1;
        favorites = [];
    }
    console.log("History and Settings after loading data:", history, showPageName, historyLength);
    // Restore window size
    figma.clientStorage.getAsync("frameHopWindowSize").then((size) => {
        if (size) {
            currentWindowWidth = size.width;
            currentWindowHeight = size.height;
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
        trackAllObjects: trackAllObjects,
        autoResize: autoResize,
        hasMultiplePages: figma.root.children.length > 1,
    });
}
async function updateUI() {
    // This variable will hold the ID of the currently selected frame, if any
    const currentSelectionId = figma.currentPage.selection.length > 0
        ? figma.currentPage.selection[0].id
        : null;
    // Page-name display only makes sense when there's more than one page to
    // disambiguate against. Suppress everywhere when single-page (settings
    // toggle, history items, viewport favorites).
    const hasMultiplePages = figma.root.children.length > 1;
    // Update currentFavoriteIndex based on the current selection — but if the
    // user just clicked a viewport favorite, the canvas selection is empty by
    // design, so the recompute would clear the highlight. Keep the viewport
    // highlighted until something else (a new selection or another favorite
    // click) actually replaces it.
    const previousFav = favorites[currentFavoriteIndex];
    const keepViewportHighlight = !!previousFav && !!previousFav.isViewport && !currentSelectionId;
    if (!keepViewportHighlight) {
        currentFavoriteIndex = favorites.findIndex((fav) => fav.id === currentSelectionId);
    }
    // Update favorites with async node lookups
    const updatedFavorites = [];
    const enrichedFavorites = [];
    for (const fav of favorites) {
        if (fav.isViewport) {
            updatedFavorites.push(fav);
            enrichedFavorites.push(Object.assign(Object.assign({}, fav), { type: "VIEWPORT" }));
            continue;
        }
        const node = await figma.getNodeByIdAsync(fav.id);
        if (node) {
            // Refresh pageName/pageId from the live page so renames or moves
            // between pages are reflected immediately, instead of showing stale
            // values from when the favorite was first added.
            let pageNode = node.parent;
            while (pageNode && pageNode.type !== "PAGE") {
                pageNode = pageNode.parent;
            }
            const updated = Object.assign(Object.assign({}, fav), { id: fav.id, name: node.name, pageId: pageNode ? pageNode.id : fav.pageId, pageName: pageNode ? pageNode.name : fav.pageName });
            updatedFavorites.push(updated);
            enrichedFavorites.push(Object.assign(Object.assign({}, updated), { type: node.type, shapeType: node.type === "SHAPE_WITH_TEXT"
                    ? node.shapeType
                    : undefined, isVariant: node.type === "COMPONENT" &&
                    !!node.parent &&
                    node.parent.type === "COMPONENT_SET", isImage: "fills" in node &&
                    Array.isArray(node.fills) &&
                    node.fills.some((f) => f && f.type === "IMAGE" && f.visible !== false) }));
        }
    }
    favorites = updatedFavorites;
    // Slice the history to respect the historyLength setting
    const limitedHistory = history.slice(-historyLength);
    // Reverse the history for display purposes
    const reversedHistory = limitedHistory.reverse();
    const recentHistory = [];
    for (const item of reversedHistory) {
        const node = await figma.getNodeByIdAsync(item.frameId);
        const page = node ? await figma.getNodeByIdAsync(item.pageId) : null;
        if (node && page) {
            recentHistory.push({
                id: node.id,
                name: node.name || (node.type === "SECTION" ? "Section" : "Unnamed"),
                pageId: page.id,
                type: node.type,
                shapeType: node.type === "SHAPE_WITH_TEXT"
                    ? node.shapeType
                    : undefined,
                isVariant: node.type === "COMPONENT" &&
                    !!node.parent &&
                    node.parent.type === "COMPONENT_SET",
                isImage: "fills" in node &&
                    Array.isArray(node.fills) &&
                    node.fills.some((f) => f && f.type === "IMAGE" && f.visible !== false),
                isSection: item.isSection || false,
                pageName: figma.editorType === "figma" && showPageName && hasMultiplePages
                    ? page.name
                    : "",
            });
        }
    }
    // Send the updated information to the UI
    figma.ui.postMessage({
        type: "update",
        historyData: recentHistory,
        currentFrameId: currentSelectionId,
        currentPageId: figma.currentPage.id,
        favorites: enrichedFavorites,
        currentFavoriteIndex: currentFavoriteIndex,
        showPageName: showPageName,
        historyLength: historyLength,
        hasMultiplePages: hasMultiplePages,
    });
    console.log("updateUI - Recent history for UI:", recentHistory);
    console.log("updateUI - Updated favorites:", favorites);
}
async function jumpToFrame(frameId) {
    // Viewport favorite: restore saved camera state instead of selecting a node.
    const vpFav = favorites.find((f) => f.id === frameId && f.isViewport);
    if (vpFav && vpFav.viewportState && vpFav.pageId) {
        const page = await figma.getNodeByIdAsync(vpFav.pageId);
        if (page && page.type === "PAGE") {
            isNavigating = true;
            await figma.setCurrentPageAsync(page);
            figma.currentPage.selection = [];
            // Zoom must be set before center per the Figma plugin API.
            figma.viewport.zoom = vpFav.viewportState.zoom;
            figma.viewport.center = {
                x: vpFav.viewportState.x,
                y: vpFav.viewportState.y,
            };
            currentFavoriteIndex = favorites.findIndex((f) => f.id === frameId);
            // A viewport jump is a side excursion off the history timeline — it
            // shouldn't consume a history step. Bump currentIndex so the next
            // hopBackwards returns to the user's last history position instead of
            // skipping past it.
            if (currentIndex >= 0 && currentIndex < history.length) {
                currentIndex += 1;
            }
            // Defer clearing isNavigating: the `selection = []` above queues a
            // selectionchange event that fires after this function returns. If we
            // reset isNavigating synchronously, the event slips through and
            // updateHistory's empty-selection branch resets currentIndex back to
            // history.length - 1, undoing the bump above.
            setTimeout(() => {
                isNavigating = false;
            }, 50);
            console.log("Restored viewport favorite:", frameId, "on page:", page.name);
        }
        else {
            console.log("Page not found for viewport favorite:", frameId);
        }
        await updateUI();
        return;
    }
    const targetFrame = await figma.getNodeByIdAsync(frameId);
    if (targetFrame) {
        let targetPage = targetFrame.parent;
        // Traverse up the node hierarchy until we find a page.
        while (targetPage && targetPage.type !== "PAGE") {
            targetPage = targetPage.parent;
        }
        if (targetPage) {
            isNavigating = true;
            await figma.setCurrentPageAsync(targetPage);
            figma.currentPage.selection = [targetFrame];
            figma.viewport.scrollAndZoomIntoView([targetFrame]);
            isNavigating = false;
            // Update currentIndex and currentFavoriteIndex
            currentIndex = history.findIndex((item) => item.frameId === frameId);
            currentFavoriteIndex = favorites.findIndex((item) => item.id === frameId);
            console.log("Jumped to Frame:", frameId, "on Page:", targetPage.name);
        }
        else {
            console.log("Page not found for frame:", frameId);
        }
    }
    else {
        console.log("Frame not found:", frameId);
    }
    await updateUI();
}
const RESTRICTED_TRACK_TYPES = new Set([
    "FRAME",
    "COMPONENT",
    "COMPONENT_SET",
    "INSTANCE",
    "SECTION",
]);
function getPageIdForNode(node) {
    let cur = node.parent;
    while (cur && cur.type !== "PAGE")
        cur = cur.parent;
    return cur ? cur.id : null;
}
async function updateHistory() {
    const currentSelection = figma.currentPage.selection;
    if (currentSelection.length > 0) {
        const selectedItem = currentSelection[0];
        console.log("Selected item type:", selectedItem.type);
        const itemType = selectedItem.type;
        const typeAllowed = trackAllObjects || RESTRICTED_TRACK_TYPES.has(itemType);
        if (typeAllowed) {
            const itemId = selectedItem.id;
            const pageId = getPageIdForNode(selectedItem);
            if (!pageId) {
                await updateUI();
                return;
            }
            const isSection = itemType === "SECTION";
            const item = { frameId: itemId, pageId: pageId, isSection: isSection };
            const itemIndex = history.findIndex((h) => h.frameId === itemId);
            if (itemIndex === -1) {
                // Add new item and slice the history if it exceeds historyLength
                history.push(item);
                if (history.length > historyLength) {
                    history = history.slice(-historyLength);
                }
                currentIndex = history.length - 1;
            }
            else {
                // Update pageId in case frame was moved, and update currentIndex
                history[itemIndex].pageId = pageId;
                currentIndex = itemIndex;
            }
            maybeAutoEnablePageNames();
            updatePluginData();
            await updateUI();
        }
    }
    else {
        // Reset currentIndex if nothing is selected
        currentIndex = history.length > 0 ? history.length - 1 : -1;
        updatePluginData();
        await updateUI();
    }
}
figma.on("selectionchange", () => {
    if (!isNavigating && !isHopping) {
        updateHistory();
    }
});
// Always resolve currentIndex from the actual current selection
function resolveCurrentIndex() {
    if (figma.currentPage.selection.length > 0) {
        const selectedId = figma.currentPage.selection[0].id;
        const idx = history.findIndex((item) => item.frameId === selectedId);
        if (idx >= 0) {
            currentIndex = idx;
        }
    }
}
// Handle hopping forwards in history
async function hopForwards() {
    // Read currentIndex directly from storage — the in-memory value is unreliable
    // because 0 || -1 === -1 (JS treats 0 as falsy) and async corruption
    const fwdData = figma.root.getPluginData("frameHopData");
    if (fwdData) {
        const parsed = JSON.parse(fwdData);
        if (parsed.currentIndex !== undefined) {
            currentIndex = parsed.currentIndex;
        }
    }
    resolveCurrentIndex();
    console.log("Before Hop Forwards: currentIndex =", currentIndex, ", history =", history);
    if (currentIndex >= 0 && currentIndex < history.length - 1) {
        currentIndex += 1;
        await jumpToFrame(history[currentIndex].frameId);
        updatePluginData();
        await updateUI();
        console.log("After Hop Forwards: currentIndex =", currentIndex);
    }
}
// Handle hopping backwards in history
async function hopBackwards() {
    // Read currentIndex directly from storage — the in-memory value is unreliable
    const bwdData = figma.root.getPluginData("frameHopData");
    if (bwdData) {
        const parsed = JSON.parse(bwdData);
        if (parsed.currentIndex !== undefined) {
            currentIndex = parsed.currentIndex;
        }
    }
    resolveCurrentIndex();
    console.log("Before Hop Backwards: currentIndex =", currentIndex, ", history =", history);
    if (currentIndex > 0) {
        currentIndex -= 1;
        await jumpToFrame(history[currentIndex].frameId);
        updatePluginData();
        await updateUI();
        console.log("After Hop Backwards: currentIndex =", currentIndex);
    }
}
async function cycleHistoryLength() {
    const lengths = [8, 16];
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
    currentFavoriteIndex = favorites.findIndex((fav) => fav.id === currentFavoriteId);
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
figma.ui.onmessage = async (msg) => {
    switch (msg.type) {
        case "jumpToFrame":
            await jumpToFrame(msg.frameId);
            updatePluginData();
            break;
        case "hopBackwards":
            await hopBackwards();
            break;
        case "hopForwards":
            await hopForwards();
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
            favorites = msg.favorites.map((fav) => ({
                id: fav.id,
                name: fav.name,
                customName: fav.customName,
                pageId: fav.pageId,
                pageName: fav.pageName,
                isSection: fav.isSection,
                isViewport: fav.isViewport,
                viewportState: fav.viewportState,
            }));
            updatePluginData();
            await updateUI();
            break;
        case "saveViewport": {
            const vp = figma.viewport;
            const count = favorites.filter((f) => f.isViewport).length + 1;
            favorites.push({
                id: `viewport-${Date.now()}-${Math.random()
                    .toString(36)
                    .slice(2, 7)}`,
                name: `Viewport ${count}`,
                isViewport: true,
                pageId: figma.currentPage.id,
                pageName: figma.currentPage.name,
                viewportState: { x: vp.center.x, y: vp.center.y, zoom: vp.zoom },
            });
            updatePluginData();
            await updateUI();
            break;
        }
        case "renameFavorite": {
            const fav = favorites.find((f) => f.id === msg.id);
            if (fav) {
                const trimmed = (msg.customName || "").trim();
                if (trimmed)
                    fav.customName = trimmed;
                else
                    delete fav.customName;
                updatePluginData();
                await updateUI();
            }
            break;
        }
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
        case "manualResize": {
            const { width, height } = msg;
            currentWindowWidth = width;
            currentWindowHeight = height;
            figma.ui.resize(width, height);
            figma.clientStorage.setAsync("frameHopWindowSize", { width, height });
            // A manual drag means the user wants control — turn auto-resize off.
            if (autoResize) {
                autoResize = false;
                updatePluginData();
                figma.ui.postMessage({ type: "autoResizeChanged", value: false });
            }
            break;
        }
        case "autoResize": {
            if (!autoResize)
                break;
            const clamped = Math.max(AUTO_RESIZE_MIN_HEIGHT, Math.min(computeAutoResizeMaxHeight(), msg.height));
            currentWindowHeight = clamped;
            figma.ui.resize(currentWindowWidth, clamped);
            figma.clientStorage.setAsync("frameHopWindowSize", {
                width: currentWindowWidth,
                height: clamped,
            });
            break;
        }
        case "toggleAutoResize":
            autoResize = !!msg.value;
            updatePluginData();
            break;
        case "updateTheme":
            currentTheme = msg.theme;
            updatePluginData();
            figma.ui.postMessage({ type: "applyTheme", theme: currentTheme });
            break;
        // Track All Objects is now permanently enabled — toggle removed.
    }
};
// Command handling
if (figma.command === "openFrameHop") {
    figma.showUI(__html__, { width: 252, height: 360 });
    loadPluginData();
    // Update history for the current selection when opening the plugin UI
    if (figma.currentPage.selection.length > 0) {
        updateHistory();
    }
}
else if (figma.command === "hopBackwards" ||
    figma.command === "hopForwards") {
    // Suppress updateHistory during hop initialization to prevent race conditions
    // that corrupt currentIndex between loadPluginData and the hop operation
    isHopping = true;
    figma.showUI(__html__, { width: 252, height: 360 });
    loadPluginData().then(async () => {
        // Re-read currentIndex directly from saved plugin data right before hopping.
        // The in-memory currentIndex gets corrupted to -1 during loadPluginData's async
        // operations (multiple await points in updateUI). Re-reading from the persistent
        // store bypasses whatever is resetting the in-memory variable.
        const savedData = figma.root.getPluginData("frameHopData");
        if (savedData) {
            const parsed = JSON.parse(savedData);
            if (parsed.currentIndex !== undefined) {
                currentIndex = parsed.currentIndex;
                console.log("Restored currentIndex from saved data:", currentIndex);
            }
        }
        if (figma.command === "hopBackwards") {
            await hopBackwards();
        }
        else if (figma.command === "hopForwards") {
            await hopForwards();
        }
        isHopping = false;
    });
}
else if (figma.command === "addViewport") {
    figma.showUI(__html__, { width: 252, height: 360 });
    loadPluginData().then(async () => {
        const vp = figma.viewport;
        const count = favorites.filter((f) => f.isViewport).length + 1;
        favorites.push({
            id: `viewport-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: `Viewport ${count}`,
            isViewport: true,
            pageId: figma.currentPage.id,
            pageName: figma.currentPage.name,
            viewportState: { x: vp.center.x, y: vp.center.y, zoom: vp.zoom },
        });
        updatePluginData();
        await updateUI();
    });
}
else if (figma.command === "addToFavorites") {
    figma.showUI(__html__, { width: 252, height: 360 });
    loadPluginData().then(async () => {
        const selection = figma.currentPage.selection;
        if (selection.length === 0) {
            figma.notify("Select a frame or object first");
            return;
        }
        const node = selection[0];
        if (favorites.some((fav) => fav.id === node.id)) {
            figma.notify("Already in favorites");
            return;
        }
        let pageNode = node.parent;
        while (pageNode && pageNode.type !== "PAGE") {
            pageNode = pageNode.parent;
        }
        favorites.push({
            id: node.id,
            name: node.name,
            pageId: pageNode ? pageNode.id : figma.currentPage.id,
            pageName: pageNode ? pageNode.name : figma.currentPage.name,
            isViewport: false,
        });
        updatePluginData();
        await updateUI();
    });
}
