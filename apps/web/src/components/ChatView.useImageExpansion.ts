import { useCallback, useEffect, useState } from "react";

export interface ExpandedImageItem {
  src: string;
  name: string;
}

export interface ExpandedImageState {
  images: ExpandedImageItem[];
  index: number;
}

export interface ImageExpansionResult {
  expandedImage: ExpandedImageState | null;
  expandedImageItem: ExpandedImageItem | null;
  setExpandedImage: (state: ExpandedImageState | null) => void;
  closeExpandedImage: () => void;
  navigateExpandedImage: (direction: -1 | 1) => void;
  onExpandTimelineImage: (preview: ExpandedImageState) => void;
}

export function useImageExpansion(): ImageExpansionResult {
  const [expandedImage, setExpandedImage] = useState<ExpandedImageState | null>(null);

  const closeExpandedImage = useCallback(() => {
    setExpandedImage(null);
  }, []);

  const navigateExpandedImage = useCallback((direction: -1 | 1) => {
    setExpandedImage((existing) => {
      if (!existing || existing.images.length <= 1) {
        return existing;
      }
      const nextIndex =
        (existing.index + direction + existing.images.length) % existing.images.length;
      if (nextIndex === existing.index) {
        return existing;
      }
      return { ...existing, index: nextIndex };
    });
  }, []);

  const onExpandTimelineImage = useCallback((preview: ExpandedImageState) => {
    setExpandedImage(preview);
  }, []);

  // Keyboard navigation for expanded image
  useEffect(() => {
    if (!expandedImage) {
      return;
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeExpandedImage();
        return;
      }
      if (expandedImage.images.length <= 1) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        navigateExpandedImage(-1);
        return;
      }
      if (event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      navigateExpandedImage(1);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeExpandedImage, expandedImage, navigateExpandedImage]);

  const expandedImageItem = expandedImage
    ? (expandedImage.images[expandedImage.index] ?? null)
    : null;

  return {
    expandedImage,
    expandedImageItem,
    setExpandedImage,
    closeExpandedImage,
    navigateExpandedImage,
    onExpandTimelineImage,
  };
}
