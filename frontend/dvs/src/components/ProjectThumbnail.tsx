import { useState } from "react";
import { type Language, type Maker } from "../data/config";

export function ProjectThumbnail({ className, lang, maker }: {
  className: string;
  lang: Language;
  maker: Maker;
}) {
  const [loadedImage, setLoadedImage] = useState("");
  const initial = Array.from(maker.title[lang].trim())[0];
  return (
    <span aria-hidden="true" className={`project-thumbnail ${className}`}>
      <span className="project-thumbnail__initial">{initial}</span>
      <img
        alt=""
        className={`maker-image ${loadedImage === maker.image ? "is-loaded" : ""}`}
        loading="lazy"
        onLoad={() => setLoadedImage(maker.image)}
        src={maker.image}
      />
    </span>
  );
}
