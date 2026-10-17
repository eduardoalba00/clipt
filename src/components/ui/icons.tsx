/** Hugeicons at stroke 1.75, like MonoCode. Deep imports keep the catalog
 * out of the bundle. */
import { HugeiconsIcon, type HugeiconsIconProps, type IconSvgElement } from "@hugeicons/react";
import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import AppWindowIcon from "@hugeicons/core-free-icons/AppWindowIcon";
import BrowserIcon from "@hugeicons/core-free-icons/BrowserIcon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import CropIcon from "@hugeicons/core-free-icons/CropIcon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import Mic01Icon from "@hugeicons/core-free-icons/Mic01Icon";
import MonitorIcon from "@hugeicons/core-free-icons/MonitorIcon";
import PauseIcon from "@hugeicons/core-free-icons/PauseIcon";
import PipetteIcon from "@hugeicons/core-free-icons/PipetteIcon";
import PlayIcon from "@hugeicons/core-free-icons/PlayIcon";
import RedoIcon from "@hugeicons/core-free-icons/RedoIcon";
import SquareDashedIcon from "@hugeicons/core-free-icons/SquareDashedIcon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import UndoIcon from "@hugeicons/core-free-icons/UndoIcon";
import Upload04Icon from "@hugeicons/core-free-icons/Upload04Icon";
import Video01Icon from "@hugeicons/core-free-icons/Video01Icon";
import VideoReplayIcon from "@hugeicons/core-free-icons/VideoReplayIcon";

export type IconProps = Omit<HugeiconsIconProps, "icon">;

function wrap(icon: IconSvgElement, name: string) {
  function Icon({ strokeWidth = 1.75, size = 16, ...props }: IconProps) {
    return <HugeiconsIcon icon={icon} strokeWidth={strokeWidth} size={size} {...props} />;
  }
  Icon.displayName = name;
  return Icon;
}

export const Plus = wrap(Add01Icon, "Plus");
export const Alert = wrap(AlertCircleIcon, "Alert");
export const Back = wrap(ArrowLeft01Icon, "Back");
export const Forward = wrap(ArrowRight01Icon, "Forward");
export const WindowIcon = wrap(AppWindowIcon, "WindowIcon");
export const Browser = wrap(BrowserIcon, "Browser");
export const Close = wrap(Cancel01Icon, "Close");
export const Crop = wrap(CropIcon, "Crop");
export const Folder = wrap(Folder01Icon, "Folder");
export const Mic = wrap(Mic01Icon, "Mic");
export const Screen = wrap(MonitorIcon, "Screen");
export const Pause = wrap(PauseIcon, "Pause");
export const Pipette = wrap(PipetteIcon, "Pipette");
export const Play = wrap(PlayIcon, "Play");
export const Redo = wrap(RedoIcon, "Redo");
export const Selection = wrap(SquareDashedIcon, "Selection");
export const Check = wrap(Tick02Icon, "Check");
export const Undo = wrap(UndoIcon, "Undo");
export const ExportIcon = wrap(Upload04Icon, "ExportIcon");
export const Camera = wrap(Video01Icon, "Camera");
export const Resume = wrap(VideoReplayIcon, "Resume");
