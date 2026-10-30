import browser from "webextension-polyfill";

export class App {
	windowWorkspaces: Map<number, string | null>;

	constructor() {
		this.windowWorkspaces = new Map();
	}

	loadFromStorage() {
		browser.storage.local.get(["windowWorkspaces"]).then((data) => {
			this.windowWorkspaces = new Map();
			if (data.windowWorkspaces) {
				Object.entries(data.windowWorkspaces).forEach(([k, v]) => {
					let windowId = parseInt(k, 10);
					this.windowWorkspaces.set(windowId, v.toString());
				});
			}

			browser.windows.getAll().then((windows) => {
				windows.forEach((window) => {
					if (window.id) {
						this.updateWindowTabs(window.id);
					}
				});
			});
		});
	}

	saveWorkspaces() {
		let workspacesData = {};
		for (let [k, v] of this.windowWorkspaces.entries()) {
			workspacesData[k] = v;
		}

		browser.storage.local.set({
			windowWorkspaces: workspacesData,
		});
	}

	updateWindows() {
		browser.windows.getAll().then((windows) => {
			windows.forEach((window) => {
				if (window.id && !this.windowWorkspaces.has(window.id)) {
					this.windowWorkspaces.set(window.id, null);
				}
			});

			for (const key of this.windowWorkspaces.keys()) {
				if (!windows.map((w) => w.id).includes(key)) {
					this.windowWorkspaces.delete(key);
				}
			}
			this.saveWorkspaces();
		});
	}

	updateWindowTabs(windowId: number) {
		const currentWorkspace = this.windowWorkspaces.get(windowId);

		let hideTabs: number[] = [];
		let showTabs: number[] = [];

		browser.tabs.query({ windowId }).then((tabs) => {
			tabs.forEach((tab) => {
				if (tab.id) {
					// System tabs are always shown
					if (tab.url?.startsWith("about:") && tab.url != "about:newtab") {
						showTabs.push(tab.id);
						return;
					}

					if (!currentWorkspace) {
						showTabs.push(tab.id);
						return;
					}

					if (tab.cookieStoreId == currentWorkspace) {
						showTabs.push(tab.id);
					} else {
						hideTabs.push(tab.id);
					}
				}
			});

			browser.tabs.show(showTabs);
			browser.tabs.hide(hideTabs);
		});
	}

	getMostRecentTab(tabs: browser.Tabs.Tab[]): browser.Tabs.Tab {
		return tabs.reduce((mostRecent, current) => {
			if (!current.lastAccessed || !mostRecent.lastAccessed) {
				return mostRecent;
			}
			if (!mostRecent || current.lastAccessed > mostRecent.lastAccessed) {
				return current;
			}
			return mostRecent;
		}, tabs[0]);
	}

	switchWindowWorkspace(windowId: number, cookieStoreId: string | null) {
		// Handle selecting an active tab when switching workspaces
		browser.tabs.query({ windowId, active: true }).then((activeTabs) => {
			browser.tabs
				.query({ windowId, cookieStoreId: cookieStoreId ?? undefined })
				.then((tabs) => {
					// No need to select a tab when unsetting a workspace or if the current active tab is already in the newly selected workspace
					if (
						!cookieStoreId ||
						(activeTabs.length > 0 &&
							activeTabs[0].cookieStoreId == cookieStoreId)
					) {
						this.updateWindowTabs(windowId);
						return;
					}

					if (tabs.length > 0) {
						const mostRecentTab = this.getMostRecentTab(tabs);

						browser.tabs
							.update(mostRecentTab.id, {
								active: true,
							})
							.then(() => {
								this.updateWindowTabs(windowId);
							});
					} else {
						browser.tabs.create({ cookieStoreId, windowId });
						this.updateWindowTabs(windowId);
					}
				});
		});

		this.windowWorkspaces.set(windowId, cookieStoreId);
		this.saveWorkspaces();
		this.createContextMenu();
	}

	switchWindowWorkspaceByOffset(windowId: number, offset: -1 | 1) {
		browser.contextualIdentities.query({}).then((contextIds) => {
			const workspaces: (string | null)[] = [
				null,
				"firefox-default",
				...contextIds.map((contextId) => contextId.cookieStoreId),
			];
			this.switchWindowWorkspace(
				windowId,
				workspaces[
					(workspaces.indexOf(this.windowWorkspaces.get(windowId) ?? null) +
						offset +
						workspaces.length) %
						workspaces.length
				],
			);
		});
	}

	moveSelectedTabsToWorkspace(cookieStoreId: string | null) {
		browser.windows.getCurrent().then((currentWindow) => {
			if (!currentWindow.id) {
				return;
			}
			const currentWorkspace = this.windowWorkspaces.get(currentWindow.id);

			browser.tabs
				.query({ windowId: currentWindow.id, highlighted: true })
				.then((selectedTabs) => {
					selectedTabs.forEach((tab) => {
						browser.tabs.create({
							url: tab.url,
							cookieStoreId: cookieStoreId ?? undefined,
							windowId: tab.windowId,
						});
					});

					browser.tabs
						.query({
							windowId: currentWindow.id,
							cookieStoreId: currentWorkspace ?? undefined,
						})
						.then((containerTabs) => {
							const remainingTabs = containerTabs.filter(
								(tab) => !selectedTabs.map((t) => t.id).includes(tab.id),
							);

							if (remainingTabs.length == 0) {
								browser.tabs.create({
									cookieStoreId: cookieStoreId ?? undefined,
									windowId: currentWindow.id,
								});
							} else {
								const mostRecentTab = this.getMostRecentTab(remainingTabs);
								browser.tabs.update(mostRecentTab.id, { active: true });
							}

							browser.tabs.remove(
								selectedTabs.filter((t) => t.id != undefined).map((t) => t.id!),
							);

							if (currentWindow.id) {
								this.updateWindowTabs(currentWindow.id);
							}
						});
				});
		});
	}

	createContextMenu() {
		browser.windows.getCurrent().then((currentWindow) => {
			if (!currentWindow.id) {
				return;
			}

			const currentWorkspace = this.windowWorkspaces.get(currentWindow.id);

			browser.contextualIdentities.query({}).then((contextIds) => {
				browser.tabs
					.query({ windowId: currentWindow.id, highlighted: true })
					.then((selectedTabs) => {
						// Clear existing context menus
						browser.contextMenus.removeAll();

						browser.contextMenus.create({
							id: "switch-to-workspace",
							title: "Switch to workspace",
							contexts: ["tab", "page"],
						});

						browser.contextMenus.create({
							id: `switch-to-all`,
							parentId: "switch-to-workspace",
							title: "All",
							contexts: ["tab", "page"],
						});

						if (currentWorkspace != "firefox-default") {
							browser.contextMenus.create({
								id: `switch-to-firefox-default`,
								parentId: "switch-to-workspace",
								title: "Default",
								contexts: ["tab", "page"],
							});
						}
						for (const contextId of contextIds) {
							if (contextId.cookieStoreId == currentWorkspace) {
								continue;
							}

							browser.contextMenus.create({
								id: `switch-to-${contextId.cookieStoreId}`,
								parentId: "switch-to-workspace",
								title: contextId.name,
								contexts: ["tab", "page"],
							});
						}

						browser.contextMenus.create({
							id: "move-to-workspace",
							title:
								selectedTabs.length > 1
									? "Move tabs to workspace"
									: "Move tab to workspace",
							contexts: ["tab"],
						});

						if (currentWorkspace != "firefox-default") {
							browser.contextMenus.create({
								id: `move-to-firefox-default`,
								parentId: "move-to-workspace",
								title: "Default",
								contexts: ["tab", "page"],
							});
						}

						for (const contextId of contextIds) {
							if (contextId.cookieStoreId == currentWorkspace) {
								continue;
							}

							if (currentWorkspace != contextId.cookieStoreId) {
								browser.contextMenus.create({
									id: `move-to-${contextId.cookieStoreId}`,
									parentId: "move-to-workspace",
									title: contextId.name,
									contexts: ["tab"],
								});
							}
						}
					});
			});
		});
	}
}
