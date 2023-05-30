// must use `var` instead of `let` to avoid of duplicated declared error when execute content script again
var workAsContent, contentPort, listened, handleMessages;

if (!listened) {
	init();
	listened = true;
}

function init() {
	handleMessages = async (message) => {
		let {op, target, filename, src, type} = message;
		if (target !== 'offscreen' && target !== 'content') {
			return false;
		}
		if (contentPort) {
			contentPort.disconnect();
			contentPort = null;
		}
		switch (op) {
			case 'convertType': {
				if (!src || !src.startsWith('data:')) {
					notify('Unexpected src');
					return false;
				}
				convertImageAsType(src, filename, type);
				break;
			}
			case 'download': {
				if (!src || !src.startsWith('data:')) {
					notify('Unexpected src');
					return false;
				}
				if (!workAsContent) {
					notify('Cannot download on offscreen');
					return false;
				}
				download(src, filename);
				break;
			}
			default: {
				console.warn(`Unexpected message type received: '${op}'.`);
				return false;
			}
		}
	};

	// work as offscreen
	chrome.runtime.onMessage.addListener(handleMessages);
	
	// work as content script for old chrome (v108-)
	chrome.runtime.onConnect.addListener(port => {
		if (port.name == 'convertType') {
			workAsContent = true;
			contentPort = port;
			port.onMessage.addListener(handleMessages);
		}
	});
}

function notify(message) {
	if (workAsContent) {
		alert(message);
		return;
	}
	chrome.runtime.sendMessage({op: 'notify', target: 'background', message});
}

function download(url, filename) {
	if (workAsContent) {
		let a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		return;
	}
	chrome.runtime.sendMessage({op: 'download', target: 'background', url, filename});
}

function convertImageAsType(src, filename, type) {
	function getDataURLOfType(img, type) {
		var canvas = document.createElement('canvas');
		canvas.width = img.width;
		canvas.height = img.height;
		var context = canvas.getContext('2d');
		var mimeType = 'image/'+(type ==  'jpg' ? 'jpeg' : type);
		context.drawImage(img, 0, 0);
		var dataurl =  canvas.toDataURL(mimeType);
		canvas = null;
		return dataurl;
	}
	function imageLoad(src, type, callback) {
		var img = new Image();
		img.onload = function() {
			var dataurl =  getDataURLOfType(this, type);
			callback(dataurl);
		};
		img.onerror = function() {
			notify({error: 'errorOnLoading', src});
		};
		img.src = src;
	}
	function callback(dataurl) {
		download(dataurl, filename);
	}
	if (!src.startsWith('data:')) {
	} else {
		imageLoad(src, type, callback);
	}
}
