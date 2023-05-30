let messages;

// some old chrome doesn't support chrome.i18n.getMessage in service worker.
if (!chrome.i18n?.getMessage) {
	if (!chrome.i18n) {
		chrome.i18n = {};
	}
	chrome.i18n.getMessage = (key, args) => {
		if (key == 'View_in_store') {
			return 'View in store';
		}
		if (key == 'Save_as' && args?.[0]) {
			return 'Save as ' + args[0];
		}
		return key;
	};
}

function download(url, filename) {
	chrome.downloads.download(
		{ url, filename, saveAs: true },
		function(downloadId) {
			if (!downloadId) {
				let msg = chrome.i18n.getMessage('errorOnSaving');
				if (chrome.runtime.lastError) {
					msg += ': \n'+ chrome.runtime.lastError.message;
				}
				notify(msg);
			}
		}
	);
}

async function fetchAsDataURL(src, callback) {
	if (src.startsWith('data:')) {
		callback(null, src);
		return;
	}
	fetch(src)
	.then(res => res.blob())
	.then(blob => {
		if (!blob.size) {
			throw 'Fetch failed of 0 size';
		}
		let reader = new FileReader();
		reader.onload = async function(evt){
			let dataurl = evt.target.result;
			callback(null, dataurl);
		};
		reader.readAsDataURL(blob);
	})
	.catch(error => callback(error.message || error));
}

function getSuggestedFilename(src, type) {
	//special for chrome web store apps
	if(src.match(/googleusercontent\.com\/[0-9a-zA-Z]{30,}/)){
		return 'screenshot.'+type;
	}
	if (src.startsWith('blob:') || src.startsWith('data:')) {
		return 'Untitled.'+type;
	}
	let filename = src.replace(/[?#].*/,'').replace(/.*[\/]/,'').replace(/\+/g,' ');
	filename = decodeURIComponent(filename);
	filename = filename.replace(/[\x00-\x7f]+/g, function (s){
		return s.replace(/[^\w\-\.\,@ ]+/g,'');
	});
	while(filename.match(/\.[^0-9a-z]*\./)){
		filename = filename.replace(/\.[^0-9a-z]*\./g,'.');
	}
	filename = filename.replace(/\s\s+/g,' ').trim();
	filename = filename.replace(/\.(jpe?g|png|gif|webp|svg)$/gi,'').trim();
	if(filename.length > 32){
		filename = filename.substr(0,32);
	}
	filename = filename.replace(/[^0-9a-z]+$/i,'').trim();
	if(!filename){
		filename = 'image';
	}
	return filename+'.'+type;
}

function notify(msg) {
	if (msg.error) {
		msg = (chrome.i18n.getMessage(msg.error) || msg.error) + '\n'+ (msg.srcUrl || msg.src);
	}
}

function loadMessages() {
	if (!messages) {
		messages = {};
		['errorOnSaving', 'errorOnLoading'].forEach(key => {
			messages[key] = chrome.i18n.getMessage(key);
		});
	}
	return messages;
}

async function hasOffscreenDocument(path) {
	const offscreenUrl = chrome.runtime.getURL(path);
	const matchedClients = await clients.matchAll();
	for (const client of matchedClients) {
		if (client.url === offscreenUrl) {
			return true;
		}
	}
	return false;
}

chrome.runtime.onInstalled.addListener(function () {
	loadMessages();
	['JPG','PNG','WebP'].forEach(function (type){
		chrome.contextMenus.create({
			"id" : "save_as_" + type.toLowerCase(),
			"title" : chrome.i18n.getMessage("Save_as", [type]),
			"type" : "normal",
			"contexts" : ["image"],
		});
	});
	chrome.contextMenus.create({
		"id" : "sep_1",
		"type" : "separator",
		"contexts" : ["image"]
	});
	chrome.contextMenus.create({
		"id" : "view_in_store",
		"title" : chrome.i18n.getMessage("View_in_store"),
		"type" : "normal",
		"contexts" : ["image"],
	});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	let {target, op} = message || {};
	if (target == 'background' && op) {
		if (op == 'download') {
			let {url, filename} = message;
			download(url, filename);
		} else if (op == 'notify') {
			let msg = message.message;
			if (msg && msg.error) {
				let msg2 = chrome.i18n.getMessage(msg.error) || msg.error;
				if (msg.src) {
					msg2 += '\n'+ msg.src;
				}
				notify(msg2);
			} else {
				notify(message);
			}
		} else {
			console.warn('unknown op: ' + op);
		}
	}
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	let {menuItemId, mediaType, srcUrl} = info;
	let connectTab = () => {
		// for old chrome v108-
		let port = chrome.tabs.connect(
			tab.id,
			{
				name: 'convertType',
				frameId: info.frameId,
			},
		);
		return port;
	};
	if (menuItemId.startsWith('save_as_')) {
		if (mediaType=='image' && srcUrl) {
			let type = menuItemId.replace('save_as_', '');
			let filename = getSuggestedFilename(srcUrl, type);
			loadMessages();
			let noChange = srcUrl.startsWith('data:image/' + (type == 'jpg' ? 'jpeg' : type) + ';');
			if (!chrome.offscreen) {
				// for old chrome v108-
				let frameIds = info.frameId ? [] : void 0;
				await chrome.scripting.executeScript({
					target: { tabId: tab.id, frameIds },
					files: ["offscreen.js"], // content script and offscreen use the same file.
				});
			}
			fetchAsDataURL(srcUrl, async function(error, dataurl) {
				if (error) {
					notify({error, srcUrl});
					return;
				}
				// offscreen api need chrome v109+
				if (!chrome.offscreen) {
					// for old chrome v108-
					let port = connectTab();
					await port.postMessage({ op: noChange ? 'download' : 'convertType', target: 'content', src: dataurl, type, filename });
					return;
				}
				// for new chrome v109+
				if (noChange) {
					download(dataurl, filename);
					return;
				}
				const offscreenSrc = 'offscreen.html'
				if (!(await hasOffscreenDocument(offscreenSrc))) {
					await chrome.offscreen.createDocument({
						url: chrome.runtime.getURL(offscreenSrc),
						reasons: ['DOM_SCRAPING'],
						justification: 'Download a image for user',
					});
				}
				await chrome.runtime.sendMessage({ op: 'convertType', target: 'offscreen', src: dataurl, type, filename });
			});
			return;
		} else {
			notify(chrome.i18n.getMessage("errorIsNotImage"));
		}
		return;
	}
	if (menuItemId == 'view_in_store') {
		let url = "https://chrome.google.com/webstore/detail/save-image-as-type/" + chrome.i18n.getMessage("@@extension_id");
		chrome.tabs.create({ url: url, index: tab.index + 1 });
		return;
	}
});
