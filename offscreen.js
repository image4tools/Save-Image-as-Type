chrome.runtime.onMessage.addListener(handleMessages);

async function handleMessages(message) {
	let {op, target, filename, src, type} = message;
	if (target !== 'offscreen') {
	  return false;
	}
	switch (op) {
	  case 'convertType':
		if (!src || !src.startsWith('data:')) {
			notify('Unexpected src');
			return false;
		}
		convertImageAsType(src, filename, type);
		break;
	  default:
		console.warn(`Unexpected message type received: '${op}'.`);
		return false;
	}
}

function notify(message) {
	chrome.runtime.sendMessage({op: 'notify', target: 'background', message});
}

function download(url, filename) {
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
