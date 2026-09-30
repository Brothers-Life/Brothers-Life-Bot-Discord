export function createRingBuffer(max) {
	const items = [];
	return {
		push(item) {
			items.push(item);
			if (items.length > max) items.splice(0, items.length - max);
		},
		lines() {
			return items.slice();
		},
	};
}
