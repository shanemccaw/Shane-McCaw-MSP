import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

interface MediaItem {
  filename: string;
  url: string;
  source: "generated" | "uploaded";
  size: number;
  createdAt: string;
}

interface AssetPickerModalProps {
  onSelect: (url: string) => void;
  onClose: () => void;
}

export function AssetPickerModal({ onSelect, onClose }: AssetPickerModalProps) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const { data: items = [], isLoading } = useQuery<MediaItem[]>({
    queryKey: ["media-library"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/media-library");
      if (!res.ok) throw new Error("Failed to load media library");
      return res.json() as Promise<MediaItem[]>;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetchWithAuth("/api/admin/media-library/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" })) as { error?: string };
        throw new Error(err.error ?? "Upload failed");
      }
      return res.json() as Promise<MediaItem>;
    },
    onSuccess: () => {
      setUploadError(null);
      void queryClient.invalidateQueries({ queryKey: ["media-library"] });
    },
    onError: (err: Error) => {
      setUploadError(err.message);
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      uploadMutation.mutate(file);
    }
    e.target.value = "";
  }

  function handleSelect(url: string) {
    setSelected(url);
  }

  function handleConfirm() {
    if (selected) {
      onSelect(selected);
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-3xl mx-4 bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363D]">
          <div>
            <h2 className="text-sm font-semibold text-[#E6EDF3]">Media Library</h2>
            <p className="text-[11px] text-[#7D8590] mt-0.5">Select an image or upload a new one</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#0078D4] hover:bg-[#1084D8] text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploadMutation.isPending ? (
                <>
                  <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <span className="text-base leading-none">↑</span>
                  Upload image
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#30363D] rounded-lg transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Error banner */}
        {uploadError && (
          <div className="mx-5 mt-3 px-3 py-2 bg-red-900/30 border border-red-700/40 rounded-lg text-xs text-red-300">
            {uploadError}
          </div>
        )}

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-40 text-[#7D8590] text-xs">
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-center">
              <span className="text-3xl opacity-30">🖼️</span>
              <p className="text-xs text-[#7D8590]">No images yet. Upload one to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {items.map(item => {
                const isSelected = selected === item.url;
                return (
                  <button
                    key={item.filename}
                    onClick={() => handleSelect(item.url)}
                    className={`relative group rounded-lg overflow-hidden border-2 transition-all text-left ${
                      isSelected
                        ? "border-[#0078D4] ring-2 ring-[#0078D4]/40"
                        : "border-[#30363D] hover:border-[#0078D4]/60"
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="aspect-square bg-[#0D1117] flex items-center justify-center overflow-hidden">
                      <img
                        src={item.url}
                        alt={item.filename}
                        className="w-full h-full object-cover"
                        onError={e => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    </div>

                    {/* Selected checkmark overlay */}
                    {isSelected && (
                      <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-[#0078D4] rounded-full flex items-center justify-center shadow">
                        <span className="text-white text-[10px] leading-none">✓</span>
                      </div>
                    )}

                    {/* Source badge */}
                    <div className="absolute top-1.5 left-1.5">
                      <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${
                        item.source === "generated"
                          ? "bg-amber-500/80 text-amber-900"
                          : "bg-[#0078D4]/80 text-white"
                      }`}>
                        {item.source === "generated" ? "AI" : "Uploaded"}
                      </span>
                    </div>

                    {/* Filename + size tooltip on hover */}
                    <div className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1 translate-y-full group-hover:translate-y-0 transition-transform">
                      <p className="text-[9px] text-[#E6EDF3] truncate">{item.filename}</p>
                      <p className="text-[9px] text-[#7D8590]">{formatSize(item.size)}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#30363D]">
          <p className="text-[11px] text-[#484F58]">
            {items.length} image{items.length !== 1 ? "s" : ""} in library
            {selected ? " · 1 selected" : ""}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-[#7D8590] hover:text-[#E6EDF3] rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selected}
              className="px-4 py-1.5 text-xs font-medium bg-[#0078D4] hover:bg-[#1084D8] text-white rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Use this image
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
