export function on(target, eventName, handler, options) {
    target.addEventListener(eventName, handler, options);
    return () => target.removeEventListener(eventName, handler, options);
}

export function delegate(root, eventName, selector, handler) {
    const listener = event => {
        const match = event.target.closest(selector);
        if (match && root.contains(match)) {
            handler(event, match);
        }
    };

    root.addEventListener(eventName, listener);
    return () => root.removeEventListener(eventName, listener);
}
