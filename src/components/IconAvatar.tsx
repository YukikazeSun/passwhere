import type { StoredImage } from "../types";
import { getInitials } from "../lib/utils";

interface IconAvatarProps {
  name: string;
  image?: StoredImage | null;
  size?: "small" | "medium" | "large";
}
const PALETTES = ["coral", "teal", "blue", "mustard", "charcoal"] as const;

export function IconAvatar({ name, image, size = "medium" }: IconAvatarProps) {
  const seed = [...name].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const palette = PALETTES[seed % PALETTES.length];

  return (
    <span className={`icon-avatar icon-avatar--${size} icon-avatar--${palette}`} aria-hidden="true">
      {image?.dataUrl ? <img src={image.dataUrl} alt="" /> : getInitials(name)}
    </span>
  );
}
