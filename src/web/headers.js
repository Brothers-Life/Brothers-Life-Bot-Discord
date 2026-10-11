// Headers of every page and answer of the panel (API process and front server)
export const SECURITY_HEADERS = {
	'X-Frame-Options': 'DENY',
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'same-origin',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
	'Content-Security-Policy': [
		'default-src \'self\'',
		// Any https image (announcement previews), blob: for the card previews rendered by the server
		'img-src \'self\' data: blob: https:',
		'style-src \'self\' \'unsafe-inline\'',
		'font-src \'self\' data:',
		'connect-src \'self\'',
		// Music page: the clip of the song being played
		'frame-src https://www.youtube-nocookie.com',
		'frame-ancestors \'none\'',
		'base-uri \'self\'',
		'form-action \'self\'',
	].join('; '),
};
