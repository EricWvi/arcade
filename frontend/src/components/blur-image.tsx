import { useState } from "react";

type BlurImageProps = {
  src: string;
  /** Small blurred preview from `task images:placeholders`, shown until src has loaded. */
  placeholder: string;
  alt: string;
  /** Classes for the box. It must be positioned (relative, absolute…) and sized here. */
  className?: string;
  /** Classes for both images, such as an object position. */
  imgClassName?: string;
};

/**
 * An image that shows its blurred placeholder at once and fades the full
 * image in once it has loaded. Both images cover the box.
 */
export function BlurImage({ src, placeholder, alt, className = "", imgClassName = "" }: BlurImageProps) {
  // Tracks which src finished loading, so a new src starts from the placeholder again.
  const [loaded, setLoaded] = useState<string | null>(null);
  const done = loaded === src;
  const fill = `absolute inset-0 size-full object-cover ${imgClassName}`;

  return (
    <div className={`overflow-hidden ${className}`}>
      {/* Hidden after the fade so it never shows through transparent parts of the image. */}
      <img
        src={placeholder}
        alt=""
        aria-hidden
        className={`${fill} transition-opacity duration-300 ${done ? "opacity-0 delay-500" : ""}`}
      />
      <img
        src={src}
        alt={alt}
        decoding="async"
        // A cached image may finish before React attaches onLoad.
        ref={(el) => {
          if (el?.complete && el.naturalWidth > 0) setLoaded(src);
        }}
        onLoad={() => setLoaded(src)}
        className={`${fill} transition-opacity duration-500 ${done ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
