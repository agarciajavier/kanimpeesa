// @ts-nocheck -- runs in the service worker, not in the app.
// Impeesa: service worker for push notifications (see
// components/PushNotificationsButton.tsx and packages/api/src/utils/push.ts).
// It only shows notifications; it doesn't cache anything.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : "" };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "Impeesa", {
      body: data.body || "",
      icon: "/icon-512.png",
      badge: "/icon-512.png",
      tag: data.tag,
      renotify: !!data.tag,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data && event.notification.data.url) || "/",
    self.location.origin,
  ).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        // Reuse an open panel tab when there is one.
        for (const client of windows) {
          if (client.url.startsWith(self.location.origin) && "focus" in client)
            return client.navigate(url).then((c) => (c || client).focus());
        }
        return self.clients.openWindow(url);
      }),
  );
});
