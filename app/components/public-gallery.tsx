"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type TouchEvent,
} from "react";

import type { PublicAsset } from "../../lib/public-projection";

export type LightboxSelection = {
  images: PublicAsset[];
  index: number;
  title: string;
  opener: HTMLElement | null;
};

function wrappedIndex(index: number, length: number) {
  return (index + length) % length;
}

export function hasUniformAspectRatio(images: PublicAsset[]) {
  if (images.length < 2) return false;
  const ratios = images.map(({ width, height }) => width / height);
  return Math.max(...ratios) / Math.min(...ratios) <= 1.01;
}

function imageButton(
  image: PublicAsset,
  index: number,
  images: PublicAsset[],
  title: string,
  open: (selection: LightboxSelection) => void,
  className?: string,
  tabIndex?: number,
) {
  return (
    <button
      className={className}
      type="button"
      tabIndex={tabIndex}
      aria-label={`${title} 이미지 ${index + 1}/${images.length} 크게 보기`}
      onClick={(event) =>
        open({ images, index, title, opener: event.currentTarget })
      }
    >
      <img
        src={image.src}
        alt={image.alt}
        width={image.width}
        height={image.height}
        loading="lazy"
      />
    </button>
  );
}

export function PublicGallery({
  images,
  title,
  onOpen,
}: {
  images: PublicAsset[];
  title: string;
  onOpen: (selection: LightboxSelection) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const touchStart = useRef<number | null>(null);

  if (images.length === 0) return null;
  if (images.length === 1) {
    return (
      <div className="post-media post-media-single">
        {imageButton(images[0], 0, images, title, onOpen)}
      </div>
    );
  }

  if (hasUniformAspectRatio(images)) {
    const move = (amount: number) =>
      setActiveIndex((current) => wrappedIndex(current + amount, images.length));
    const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      move(event.key === "ArrowLeft" ? -1 : 1);
    };
    const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
      touchStart.current = event.changedTouches[0]?.clientX ?? null;
    };
    const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
      const start = touchStart.current;
      touchStart.current = null;
      if (start === null) return;
      const distance = (event.changedTouches[0]?.clientX ?? start) - start;
      if (Math.abs(distance) >= 40) move(distance > 0 ? -1 : 1);
    };

    return (
      <div
        className="post-media post-media-slider"
        role="region"
        aria-label={`${title} 이미지 슬라이더`}
        tabIndex={0}
        onKeyDown={handleKey}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className="post-media-track"
          style={{ transform: `translateX(-${activeIndex * 100}%)` }}
        >
          {images.map((image, index) => (
            <div
              className="post-media-slide"
              aria-hidden={index !== activeIndex}
              key={image.assetId}
            >
              {imageButton(
                image,
                index,
                images,
                title,
                onOpen,
                undefined,
                index === activeIndex ? 0 : -1,
              )}
            </div>
          ))}
        </div>
        <button
          className="post-media-previous"
          type="button"
          aria-label="이전 이미지"
          onClick={() => move(-1)}
        >
          ←
        </button>
        <button
          className="post-media-next"
          type="button"
          aria-label="다음 이미지"
          onClick={() => move(1)}
        >
          →
        </button>
        <p className="post-media-count" aria-live="polite">
          {activeIndex + 1} / {images.length}
        </p>
      </div>
    );
  }

  const visible = images.slice(0, 4);
  return (
    <div
      className={`post-media post-media-grid post-media-grid-${Math.min(images.length, 4)}`}
    >
      {visible.map((image, index) => (
        <div className="post-media-grid-item" key={image.assetId}>
          {imageButton(image, index, images, title, onOpen)}
          {index === 3 && images.length > 4 ? (
            <span className="post-media-more" aria-hidden="true">
              +{images.length - 4}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function OpenPublicLightbox({
  selection,
  onClose,
}: {
  selection: LightboxSelection;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const touchStart = useRef<number | null>(null);
  const [index, setIndex] = useState(selection.index);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const current = selection.images[index];
  const move = (amount: number) =>
    setIndex((value) => wrappedIndex(value + amount, selection.images.length));
  const finishClose = () => {
    const opener = selection.opener;
    onClose();
    requestAnimationFrame(() => opener?.focus());
  };
  const handleKey = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    move(event.key === "ArrowLeft" ? -1 : 1);
  };
  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    touchStart.current = event.changedTouches[0]?.clientX ?? null;
  };
  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (start === null) return;
    const distance = (event.changedTouches[0]?.clientX ?? start) - start;
    if (Math.abs(distance) >= 40) move(distance > 0 ? -1 : 1);
  };

  return (
    <dialog
      className="public-lightbox"
      ref={dialogRef}
      aria-labelledby="public-lightbox-title"
      onCancel={() => undefined}
      onClose={finishClose}
      onKeyDown={handleKey}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <div
        className="public-lightbox-frame"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="public-lightbox-heading">
          <p id="public-lightbox-title">{selection.title}</p>
          <p aria-live="polite">
            {index + 1} / {selection.images.length}
          </p>
          <button
            type="button"
            autoFocus
            aria-label="이미지 크게 보기 닫기"
            onClick={() => dialogRef.current?.close()}
          >
            닫기
          </button>
        </div>
        <img
          src={current.src}
          alt={current.alt}
          width={current.width}
          height={current.height}
        />
        {selection.images.length > 1 ? (
          <div className="public-lightbox-navigation">
            <button type="button" onClick={() => move(-1)}>
              이전
            </button>
            <button type="button" onClick={() => move(1)}>
              다음
            </button>
          </div>
        ) : null}
      </div>
    </dialog>
  );
}

export function PublicLightbox({
  selection,
  onClose,
}: {
  selection: LightboxSelection | null;
  onClose: () => void;
}) {
  if (!selection) return null;
  return (
    <OpenPublicLightbox
      selection={selection}
      onClose={onClose}
      key={`${selection.images[0]?.assetId ?? "empty"}-${selection.index}`}
    />
  );
}

export function StandalonePublicGallery({
  images,
  title,
}: {
  images: PublicAsset[];
  title: string;
}) {
  const [selection, setSelection] = useState<LightboxSelection | null>(null);
  return (
    <>
      <PublicGallery images={images} title={title} onOpen={setSelection} />
      <PublicLightbox selection={selection} onClose={() => setSelection(null)} />
    </>
  );
}
