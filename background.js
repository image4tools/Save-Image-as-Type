
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
	let srcOrigin = new URL(src).origin;
	if (!src.startsWith('blob:') && !src.startsWith('data:')) {
		let granted = await chrome.permissions.request({
			origins: [srcOrigin + '/'],
		});
		if (!granted) {
			return;
		}
	}
	fetch(src)
	.then(res => res.blob())
	.then(blob => {
		if (!blob.size) {
			throw 'Fetch failed of 0 size';
		}
		var reader = new FileReader();
		reader.onload = async function(evt){
			var dataurl = evt.target.result;
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
	var filename = src.replace(/[?#].*/,'').replace(/.*[\/]/,'').replace(/\+/g,' ');
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
	chrome.permissions.contains({
		permissions: ['notifications']
	  }, (result) => {
		if (result) {
			chrome.notifications.create(
				// 'notify',
				{
					type: 'basic',
					iconUrl: 'icon-48.png',
					title: chrome.i18n.getMessage('__MSG_extName__'),
					message: msg,
					eventTime: Date.now() + 3000,
				},
				function(notificationId){},
			);
		} else {
			console.warn(msg);
		}
	});
}

var canvas;
var messages;

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

chrome.contextMenus.onClicked.addListener((info, tab) => {
	let {menuItemId, mediaType, srcUrl} = info;
	if (menuItemId.startsWith('save_as_')) {
		if (mediaType=='image' && srcUrl) {
			let type = menuItemId.replace('save_as_', '');
			let filename = getSuggestedFilename(srcUrl, type);
			loadMessages();
			fetchAsDataURL(srcUrl, async function(error, dataurl) {
				if (error) {
					notify({error, srcUrl});
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
		var url = "https://chrome.google.com/webstore/detail/save-image-as-type/" + chrome.i18n.getMessage("@@extension_id");
		chrome.tabs.create({ url: url, index: tab.index + 1 });
		return;
	}
});
