import { useState } from "react";
import {
  HiOutlineDocumentText,
  HiOutlineEye,
  HiOutlineEyeSlash,
  HiOutlineFolder,
  HiOutlineLink,
  HiOutlinePhoto,
  HiOutlinePresentationChartBar,
  HiOutlineTableCells,
  HiOutlineTrash,
  HiPlus,
} from "react-icons/hi2";

import Button from "~/components/Button";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";

// Impeesa: Drive files and folders on a card, plus the client's Drive folder.
// Drive links can be previewed right here, without leaving Kan.

type LinkKind = "folder" | "doc" | "sheet" | "slides" | "file" | "web";

const KIND_DETAILS: Record<
  LinkKind,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  folder: { label: "Carpeta", icon: HiOutlineFolder },
  doc: { label: "Documento", icon: HiOutlineDocumentText },
  sheet: { label: "Planilla", icon: HiOutlineTableCells },
  slides: { label: "Presentación", icon: HiOutlinePresentationChartBar },
  file: { label: "Archivo", icon: HiOutlinePhoto },
  web: { label: "Link", icon: HiOutlineLink },
};

// Works out what a Google link points to and the address Google offers to
// show it embedded. Anything else is a plain link without preview.
export const describeLink = (
  url: string,
): { kind: LinkKind; previewUrl: string | null } => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "web", previewUrl: null };
  }

  const docs = /^\/(document|spreadsheets|presentation)\/d\/([\w-]+)/.exec(
    parsed.pathname,
  );
  if (parsed.hostname === "docs.google.com" && docs) {
    const [, type, id] = docs;
    const kind =
      type === "document"
        ? "doc"
        : type === "spreadsheets"
          ? "sheet"
          : "slides";
    return {
      kind,
      previewUrl: `https://docs.google.com/${type}/d/${id}/preview`,
    };
  }

  if (parsed.hostname === "drive.google.com") {
    const folder = /\/folders\/([\w-]+)/.exec(parsed.pathname);
    if (folder)
      return {
        kind: "folder",
        previewUrl: `https://drive.google.com/embeddedfolderview?id=${folder[1]}#list`,
      };

    const file =
      /\/file\/d\/([\w-]+)/.exec(parsed.pathname)?.[1] ??
      parsed.searchParams.get("id");
    if (file)
      return {
        kind: "file",
        previewUrl: `https://drive.google.com/file/d/${file}/preview`,
      };
  }

  return { kind: "web", previewUrl: null };
};

const inputClass =
  "block w-full rounded-md border-0 bg-white/5 px-3 py-1.5 text-sm text-neutral-900 shadow-sm ring-1 ring-inset ring-light-600 focus:ring-2 focus:ring-inset focus:ring-light-700 dark:bg-dark-300 dark:text-dark-1000 dark:ring-dark-700 dark:focus:ring-dark-700";

export function LinkRow({
  rowKey,
  title,
  url,
  openPreview,
  onTogglePreview,
  onDelete,
}: {
  rowKey: string;
  title: string;
  url: string;
  openPreview: string | null;
  onTogglePreview: (key: string) => void;
  onDelete?: () => void;
}) {
  const { kind, previewUrl } = describeLink(url);
  const Icon = KIND_DETAILS[kind].icon;
  const isOpen = openPreview === rowKey;

  return (
    <div>
      <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-light-100 dark:hover:bg-dark-100">
        <Icon className="h-4 w-4 shrink-0 text-light-900 dark:text-dark-900" />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 truncate text-sm text-light-1000 hover:underline dark:text-dark-1000"
        >
          {title}
        </a>
        {previewUrl && (
          <button
            type="button"
            onClick={() => onTogglePreview(rowKey)}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs text-light-900 hover:bg-light-200 dark:text-dark-900 dark:hover:bg-dark-200"
          >
            {isOpen ? (
              <HiOutlineEyeSlash className="h-4 w-4" />
            ) : (
              <HiOutlineEye className="h-4 w-4" />
            )}
            {isOpen ? "Ocultar" : "Ver"}
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            aria-label="Quitar link"
            onClick={onDelete}
            className="shrink-0 rounded-md p-1 text-light-900 opacity-0 group-hover:opacity-100 hover:bg-light-200 dark:text-dark-900 dark:hover:bg-dark-200"
          >
            <HiOutlineTrash className="h-4 w-4" />
          </button>
        )}
      </div>
      {isOpen && previewUrl && (
        <iframe
          src={previewUrl}
          title={title}
          className="mt-1 h-[480px] w-full rounded-md border border-light-300 bg-white dark:border-dark-300"
          allow="autoplay"
        />
      )}
    </div>
  );
}

export default function CardLinks({
  cardPublicId,
  viewOnly,
}: {
  cardPublicId: string;
  viewOnly: boolean;
}) {
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const queryInput = { cardPublicId };

  const links = api.cardLinks.forCard.useQuery(queryInput, {
    enabled: cardPublicId.length >= 12,
  });

  const [openPreview, setOpenPreview] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");

  const showError = () =>
    showPopup({
      header: "No se pudo guardar el link",
      message: "Revisá que sea un link completo (https://...).",
      icon: "error",
    });

  const createLink = api.cardLinks.create.useMutation({
    onSuccess: async () => {
      setUrl("");
      setTitle("");
      setIsAdding(false);
      await utils.cardLinks.forCard.invalidate(queryInput);
    },
    onError: showError,
  });

  const deleteLink = api.cardLinks.delete.useMutation({
    onSuccess: () => utils.cardLinks.forCard.invalidate(queryInput),
    onError: showError,
  });

  const togglePreview = (key: string) =>
    setOpenPreview((current) => (current === key ? null : key));

  const addLink = () => {
    const cleanUrl = url.trim();
    if (!cleanUrl) return;
    createLink.mutate({
      cardPublicId,
      url: cleanUrl,
      title: title.trim() || KIND_DETAILS[describeLink(cleanUrl).kind].label,
    });
  };

  const clientFolder = links.data?.clientFolder;
  const cardLinks = links.data?.links ?? [];

  if (!links.data || (viewOnly && !clientFolder && cardLinks.length === 0))
    return null;

  return (
    <div className="mb-6">
      <p className="mb-2 font-medium text-light-1000 dark:text-dark-1000">
        Archivos y carpetas
      </p>

      {clientFolder && (
        <LinkRow
          rowKey="client-folder"
          title={`Carpeta de ${clientFolder.name}`}
          url={clientFolder.driveUrl}
          openPreview={openPreview}
          onTogglePreview={togglePreview}
        />
      )}
      {cardLinks.map((link) => (
        <LinkRow
          key={link.publicId}
          rowKey={link.publicId}
          title={link.title}
          url={link.url}
          openPreview={openPreview}
          onTogglePreview={togglePreview}
          onDelete={
            viewOnly
              ? undefined
              : () => {
                  if (window.confirm(`¿Quitar "${link.title}" de la tarjeta?`))
                    deleteLink.mutate({ linkPublicId: link.publicId });
                }
          }
        />
      ))}

      {!viewOnly &&
        (isAdding ? (
          <div className="mt-2 space-y-2 rounded-md border border-light-300 p-3 dark:border-dark-300">
            <input
              className={inputClass}
              placeholder="Pegá el link de Drive (archivo o carpeta)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
            />
            <input
              className={inputClass}
              placeholder="Nombre (opcional), por ejemplo: Brief"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addLink();
              }}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={addLink}
                disabled={!url.trim() || createLink.isPending}
                isLoading={createLink.isPending}
              >
                Agregar
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setIsAdding(false)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="mt-1 flex items-center gap-1 rounded-md px-2 py-1 text-sm text-light-900 hover:bg-light-100 dark:text-dark-900 dark:hover:bg-dark-100"
          >
            <HiPlus className="h-4 w-4" /> Agregar archivo o carpeta
          </button>
        ))}
    </div>
  );
}
