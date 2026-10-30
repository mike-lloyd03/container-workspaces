import browser from "webextension-polyfill";
import { App } from "./App";
import { isUrl, prependScheme } from "./utils";

let app = new App();
app.loadFromStorage();
app.updateWindows();
app.createContextMenu();

browser.contextMenus.onClicked.addListener((info) => {
	browser.windows.getCurrent().then((currentWindow) => {
		if (!currentWindow.id) {
			return;
		}

		const menuItem = info.menuItemId.toString();

		if (menuItem.startsWith("switch-to-")) {
			let cookieStoreId = menuItem.replace("switch-to-", "");
			if (cookieStoreId == "all") {
				app.switchWindowWorkspace(currentWindow.id, null);
			} else {
				app.switchWindowWorkspace(currentWindow.id, cookieStoreId);
			}
		}

		if (menuItem.startsWith("move-to-")) {
			let cookieStoreId = menuItem.replace("move-to-", "");
			app.moveSelectedTabsToWorkspace(cookieStoreId);
		}

		app.createContextMenu();
	});
});

browser.commands.onCommand.addListener((command) => {
	switch (command) {
		case "workspace-previous":
		case "workspace-next": {
			browser.windows.getCurrent().then((currentWindow) => {
				if (!currentWindow.id) {
					return;
				}

				app.switchWindowWorkspaceByOffset(
					currentWindow.id,
					command === "workspace-previous" ? -1 : 1,
				);
			});
			break;
		}
	}
});

browser.tabs.onHighlighted.addListener(() => {
	app.createContextMenu();
});

browser.runtime.onMessage.addListener(async (message) => {
	switch (message.action) {
		case "switchWorkspace": {
			app.switchWindowWorkspace(message.windowId, message.workspace);
			break;
		}

		case "getContainers": {
			const allWorkspace: browser.ContextualIdentities.ContextualIdentity = {
				name: "All",
				cookieStoreId: null,
				icon: "all",
				iconUrl: "/container-icons/browser.svg",
			};

			const defaultContainer: browser.ContextualIdentities.ContextualIdentity =
				{
					name: "Default",
					cookieStoreId: "firefox-default",
					icon: "default",
					iconUrl: "/container-icons/default.svg",
					color: "gray",
					colorCode: "888888",
				};

			let containers = await browser.contextualIdentities.query({});
			containers.unshift(defaultContainer);
			containers.unshift(allWorkspace);

			const tabs = await browser.tabs.query({ windowId: message.windowId });
			const containerTabs: Record<string, number> = {};
			containers.forEach((c) => {
				const tabCount = tabs.filter(
					(t) => t.cookieStoreId == c.cookieStoreId || c.name == "All",
				).length;
				containerTabs[c.name] = tabCount;
			});

			return await Promise.resolve({
				containers,
				currentWorkspace: app.windowWorkspaces.get(message.windowId),
				containerTabs,
			});
		}

		case "newWindowWithWorkspace": {
			browser.windows
				.create({
					cookieStoreId: message.workspace,
				})
				.then((window) => {
					if (window.id) {
						app.windowWorkspaces.set(window.id, message.workspace);
					}
				});
		}
	}
	return Promise.resolve();
});

browser.tabs.onCreated.addListener((tab) => {
	// Firefox is weird about new tabs sometimes. There are three ways a new tab is created:
	// 1. User creates a new tab manually
	//     Create a new blank tab in the correct container and close the old one
	// 2. User opens the settings dialog or any Firefox tabs (about:config, about:preferences)
	//     Ignore this tab. System tabs will always be shown
	// 3. User opens a link from an external app
	//     These tabs are opened with a url of "about:blank"

	if (!tab.windowId) {
		return;
	}

	const currentWorkspace = app.windowWorkspaces.get(tab.windowId);

	if (currentWorkspace && tab.cookieStoreId != currentWorkspace) {
		if (tab.id) {
			// Firefox settings tab or external tab
			if (!tab.openerTabId) {
				if (tab.url == "about:newtab") {
					browser.tabs.create({
						cookieStoreId: currentWorkspace,
						windowId: tab.windowId,
						index: tab.index,
						active: tab.active,
					});
					browser.tabs.remove(tab.id);
				} else if (tab.title && isUrl(tab.title)) {
					browser.tabs.create({
						cookieStoreId: currentWorkspace,
						windowId: tab.windowId,
						index: tab.index,
						active: tab.active,
						url: prependScheme(tab.title),
					});
					browser.tabs.remove(tab.id);
					browser.runtime.getManifest;
				}
			} else {
				browser.tabs.create({
					cookieStoreId: currentWorkspace,
					windowId: tab.windowId,
					url: tab.url,
					index: tab.index,
					active: tab.active,
				});
				browser.tabs.remove(tab.id);
			}
		}
	}

	app.updateWindowTabs(tab.windowId);
});

browser.tabs.onRemoved.addListener((_, removeInfo) => {
	const currentWorkspace = app.windowWorkspaces.get(removeInfo.windowId);

	if (currentWorkspace) {
		browser.tabs.query({ cookieStoreId: currentWorkspace }).then((tabs) => {
			if (tabs.length == 0) {
				app.windowWorkspaces.set(removeInfo.windowId, "firefox-default");
				app.updateWindowTabs(removeInfo.windowId);
			}
		});
	}
});

browser.windows.onCreated.addListener(() => {
	app.updateWindows();
});

browser.windows.onRemoved.addListener(() => {
	app.updateWindows();
});

browser.windows.onFocusChanged.addListener(() => {
	app.createContextMenu();
});
