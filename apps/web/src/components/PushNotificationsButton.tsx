import { useEffect, useState } from "react";
import { HiOutlineBell, HiOutlineBellSlash } from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";

// Impeesa: turns push notifications on or off for this device (phone or
// computer). Automations use them to tell the person in charge of a step.

const urlBase64ToUint8Array = (base64: string) => {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const isInstalled = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isSupported = () =>
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

export default function PushNotificationsButton({
  isCollapsed,
}: {
  isCollapsed: boolean;
}) {
  const { showPopup } = usePopup();
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  // Find out whether this device already has a subscription.
  useEffect(() => {
    if (!isSupported()) {
      setIsReady(true);
      return;
    }
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setEndpoint(subscription?.endpoint ?? null))
      .catch(() => undefined)
      .finally(() => setIsReady(true));
  }, []);

  const config = api.pushNotifications.config.useQuery(
    { endpoint },
    { enabled: isReady },
  );
  const subscribe = api.pushNotifications.subscribe.useMutation();
  const unsubscribe = api.pushNotifications.unsubscribe.useMutation();

  // Push isn't set up on the server yet.
  if (!config.data?.publicKey) return null;

  const isOn = config.data.isSubscribed;
  const publicKey = config.data.publicKey;

  const turnOn = async () => {
    if (!isSupported()) {
      window.alert(
        isIos() && !isInstalled()
          ? 'En iPhone los avisos funcionan solo con el panel instalado:\n\n1. En Safari, tocá el botón Compartir (el cuadrado con la flecha).\n2. Elegí "Agregar a pantalla de inicio".\n3. Abrí el panel desde ese ícono nuevo y tocá "Activar avisos".'
          : "Este navegador no permite avisos. Probá con Chrome, Edge o Safari actualizados.",
      );
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      window.alert(
        'Los avisos están bloqueados para este sitio. Habilitalos desde el candado que está al lado de la dirección del panel y volvé a tocar "Activar avisos".',
      );
      return;
    }

    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));
    const json = subscription.toJSON();

    await subscribe.mutateAsync({
      endpoint: subscription.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
      userAgent: navigator.userAgent.slice(0, 512),
    });
    setEndpoint(subscription.endpoint);
    await config.refetch();
    showPopup({
      header: "Avisos activados",
      message:
        "Te van a llegar avisos en este dispositivo. Activalos también en tus otros dispositivos.",
      icon: "success",
    });
  };

  const turnOff = async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await unsubscribe.mutateAsync({ endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
    setEndpoint(null);
    await config.refetch();
  };

  const toggle = async () => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      await (isOn ? turnOff() : turnOn());
    } catch {
      showPopup({
        header: "No se pudieron cambiar los avisos",
        message: "Probá de nuevo en un rato.",
        icon: "error",
      });
    } finally {
      setIsBusy(false);
    }
  };

  const label = isOn ? "Avisos activados" : "Activar avisos";
  const Icon = isOn ? HiOutlineBell : HiOutlineBellSlash;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isBusy}
      title={
        isOn ? "Tocá para dejar de recibir avisos en este dispositivo" : label
      }
      className={twMerge(
        "flex w-full items-center gap-2 rounded-md p-1.5 text-sm text-neutral-900 hover:bg-light-200 disabled:opacity-60 dark:text-dark-900 dark:hover:bg-dark-200 dark:hover:text-dark-1000",
        isCollapsed && "justify-center",
      )}
    >
      <Icon
        className={twMerge(
          "h-5 w-5 shrink-0",
          isOn && "text-green-600 dark:text-green-400",
        )}
      />
      {!isCollapsed && <span>{label}</span>}
    </button>
  );
}
