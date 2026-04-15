import type { ComponentType } from "react";

import {
  Battery,
  CameraOff,
  CloudOff,
  FileWarning,
  Lock,
  Mic,
  Monitor,
  ScanFace,
  SunMedium,
  UserSearch,
  Wrench,
  CardSim,
  Wifi,
  Unlock
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { parseRiskFlags } from "@/lib/riskFlags";
import { cn } from "@/lib/utils";

type PillTone = "good" | "bad" | "warn" | "neutral" | "unknown";

type PillProps = {
  label: string;
  title: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  tone: PillTone;
  mono?: boolean;
  kind?: "lock";
};

const toneClasses: Record<PillTone, string> = {
  good: "bg-emerald-600 text-white",
  bad: "bg-rose-600 text-white",
  warn: "bg-amber-500 text-white",
  neutral: "bg-muted text-foreground",
  unknown: "text-muted-foreground"
};

function Pill({ label, title, icon: Icon, tone, mono }: PillProps) {
  const isUnknown = tone === "unknown";
  return (
    <Badge
      variant={isUnknown ? "outline" : "default"}
      title={title}
      className={cn(
        "h-6 gap-1 px-2 py-0 text-[11px]",
        isUnknown ? "border-border" : "",
        toneClasses[tone],
        mono ? "font-mono" : ""
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      <span>{label}</span>
    </Badge>
  );
}

export function PublicListingChecklist({
  riskFlags,
  openline,
  className
}: {
  riskFlags?: unknown;
  openline?: boolean | null;
  className?: string;
}) {
  const flags = parseRiskFlags(riskFlags);

  const faceTone: PillTone = flags.face_id_not_working ? "bad" : flags.face_id_working ? "good" : "unknown";
  const trutoneTone: PillTone = flags.trutone_missing ? "bad" : flags.trutone_working ? "good" : "unknown";
  const simTone: PillTone = flags.network_locked ? "bad" : openline === true ? "good" : "unknown";

  const simIcon = flags.network_locked ? Lock : openline === true ? Unlock : CardSim;
  const simLabel = flags.network_locked ? "Locked" : openline === true ? "Openline" : "SIM";
  const simTitle = flags.network_locked ? "Network locked" : openline === true ? "Openline (any SIM)" : "SIM status unknown";

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      <Pill
        label="Face ID"
        title={faceTone === "unknown" ? "Face ID status unknown" : `Face ID ${faceTone === "good" ? "working" : "not working"}`}
        icon={ScanFace}
        tone={faceTone}
      />
      <Pill
        label="TrueTone"
        title={trutoneTone === "unknown" ? "TrueTone status unknown" : `TrueTone ${trutoneTone === "good" ? "working" : "missing"}`}
        icon={SunMedium}
        tone={trutoneTone}
      />
      <Pill
        label={simLabel}
        title={simTitle}
        icon={simIcon}
        tone={simTone}
      />
    </div>
  );
}

export function BatteryHealthPill({
  batteryHealth,
  className
}: {
  batteryHealth?: number | null;
  className?: string;
}) {
  const bh =
    typeof batteryHealth === "number" && Number.isFinite(batteryHealth)
      ? Math.round(batteryHealth)
      : null;
  const tone: PillTone =
    bh == null ? "unknown" : bh >= 90 ? "good" : bh >= 80 ? "warn" : "bad";

  return (
    <div className={className}>
      <Pill
        label={bh != null ? `${bh}%` : "-"}
        title={bh != null ? `Battery health ${bh}%` : "Battery health unknown"}
        icon={Battery}
        tone={tone}
        mono
      />
    </div>
  );
}

export function ListingSignalPills({
  riskFlags,
  batteryHealth,
  openline,
  variant = "detail",
  maxWarnings = 3,
  className
}: {
  riskFlags?: unknown;
  batteryHealth?: number | null;
  openline?: boolean | null;
  variant?: "public" | "detail";
  maxWarnings?: number;
  className?: string;
}) {
  const flags = parseRiskFlags(riskFlags);
  const bh =
    typeof batteryHealth === "number" && Number.isFinite(batteryHealth) ? Math.round(batteryHealth) : null;

  const faceTone: PillTone = flags.face_id_not_working ? "bad" : flags.face_id_working ? "good" : "unknown";
  const trutoneTone: PillTone = flags.trutone_missing ? "bad" : flags.trutone_working ? "good" : "unknown";
  const simTone: PillTone = openline === true ? "good" : "unknown";
  const lockTone: PillTone = flags.network_locked ? "bad" : openline === true ? "good" : "unknown";
  const bhTone: PillTone =
    bh == null ? "unknown" : bh >= 90 ? "good" : bh >= 80 ? "warn" : "bad";

  const lockLabel = flags.network_locked ? "Lock" : openline === true ? "Unlocked" : "Lock";
  const lockTitle = flags.network_locked ? "Network locked" : openline === true ? "Unlocked" : "Lock status unknown";
  const lockIcon = flags.network_locked ? Lock : openline === true ? Unlock : Lock;

  const checklist: PillProps[] = [
    {
      label: "FaceID",
      title: faceTone === "unknown" ? "Face ID status unknown" : `Face ID ${faceTone === "good" ? "working" : "not working"}`,
      icon: ScanFace,
      tone: faceTone
    },
    {
      label: "TrueTone",
      title: trutoneTone === "unknown" ? "TrueTone status unknown" : `TrueTone ${trutoneTone === "good" ? "working" : "missing"}`,
      icon: SunMedium,
      tone: trutoneTone
    },
    {
      label: "Openline",
      title: openline === true ? "Openline (any SIM)" : "SIM status unknown",
      icon: CardSim,
      tone: simTone
    },
    {
      label: lockLabel,
      title: lockTitle,
      icon: lockIcon,
      tone: lockTone,
      kind: "lock"
    },
    {
      label: ` ${bh != null ? `${bh}%` : "-"}`,
      title: bh != null ? `Battery health ${bh}%` : "Battery health unknown",
      icon: Battery,
      tone: bhTone,
      mono: true
    }
  ];

  const warningPills: PillProps[] = [
    flags.no_description && {
      label: "Desc",
      title: "No/short description",
      icon: FileWarning,
      tone: "warn"
    },
    flags.lcd_replaced && {
      label: "LCD",
      title: "LCD replaced",
      icon: Wrench,
      tone: "warn"
    },
    flags.camera_issue && {
      label: "Cam",
      title: "Camera issue",
      icon: CameraOff,
      tone: "warn"
    },
    flags.audio_issue && {
      label: "Audio",
      title: "Microphone / speaker issue",
      icon: Mic,
      tone: "warn"
    },
    flags.button_issue && {
      label: "Button",
      title: "Button issue (volume/power)",
      icon: Wrench,
      tone: "warn"
    },
    flags.screen_issue && {
      label: "Scr",
      title: "Screen issue",
      icon: Monitor,
      tone: "warn"
    },
    flags.wifi_only && {
      label: "WiFi-only",
      title: "WiFi-only (no cellular)",
      icon: Wifi,
      tone: "warn"
    },
    flags.wanted_post && {
      label: "Buyer",
      title: "Buyer/wanted post detected",
      icon: UserSearch,
      tone: "bad"
    },
    flags.icloud_lock && {
      label: "iCloud",
      title: "iCloud / activation / reset risk",
      icon: CloudOff,
      tone: "bad"
    }
  ].filter(Boolean) as PillProps[];

  const shownWarnings = warningPills.slice(0, Math.max(0, maxWarnings));
  const extraWarnings = warningPills.length - shownWarnings.length;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {checklist.map((pill) => (
        <Pill key={pill.label} {...pill} />
      ))}
      {variant === "detail" ? shownWarnings.map((pill) => <Pill key={pill.title} {...pill} />) : null}
      {variant === "detail" && extraWarnings > 0 ? (
        <Badge variant="outline" className="h-6 px-2 py-0 text-[11px] text-muted-foreground">
          +{extraWarnings}
        </Badge>
      ) : null}
    </div>
  );
}
