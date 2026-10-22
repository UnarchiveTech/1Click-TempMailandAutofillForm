<script lang="ts">
import { navIconVariantSvg } from '@/utils/ui/icon-variants.js';
import type { KnownIconName as KnownIconNameUnion } from './icon-names.js';

/**
 * Consolidated icon component - official Google Material Symbols (outlined,
 * 24px) paths embedded locally (no external font/CDN). All glyphs are
 * fill-based Material outline geometry so the UI stays offline-friendly
 * and consistent with MD3.
 *
 * Usage: <Icon name="archive" class="w-5 h-5" />
 */

// The vocabulary lives in `./icon-names.js` so a plain `.ts` metadata table can
// type its icon field against it (a `.ts` file cannot import a type out of a
// `.svelte` file - see that module's header). Re-exported here so the component
// keeps its public export; the paths below stay the component's own concern.
export type KnownIconName = KnownIconNameUnion;

export type IconName = KnownIconName | (string & Record<never, never>);

let {
  name = '',
  class: className = '',
  /**
   * Renders the official Material Symbols filled (FILL1) variant when the
   * glyph ships one (nav icons via icon-variants.ts; star via its solid
   * catalog path), false/omitted the outlined (FILL0) glyph.
   */
  filled = false,
  /**
   * Extra CSS rotate degrees (applied after built-in chevron direction map).
   * Prefer name="chevron" / chevronDown|Up|Left|Right which share one path.
   */
  rotate = 0 as number,
}: {
  name: IconName;
  class?: string;
  filled?: boolean;
  rotate?: number;
  [key: string]: unknown;
} = $props();

/**
 * Official Material Symbols `expand_more` path (points down). Directions are
 * pure CSS rotate - saves four near-duplicate SVG paths in the icon catalog.
 *  down=0 · up=180 · left=90 · right=-90
 */
const CHEVRON_PATH = '<path d="M480-345 240-585l43-43 197 198 197-197 43 43-240 239Z"/>';
/**
 * name → degrees on the shared down-chevron.
 *
 * `Partial<Record<KnownIconName, number>>`: the table is SPARSE by design (only
 * the chevron family is rotated), but every key it does carry is a catalog name,
 * so a rename that misses one is a compile error - the failure mode this whole
 * catalog keeps meeting (`trash` → `delete` left five call sites naming nothing).
 */
const CHEVRON_DIR: Partial<Record<KnownIconName, number>> = {
  chevron: 0,
  chevronDown: 0,
  chevronUp: 180,
  chevronLeft: 90,
  chevronRight: -90,
  back: 90, // back = left-pointing chevron
};

/**
 * The glyph-path catalog: name → SVG markup.
 *
 * The type is what makes every key a catalog name: `Partial<Record<KnownIconName
 * | 'starOutline' | 'gitHub', string>>` turns a renamed or misspelled key into a
 * compile error instead of a glyph that silently renders nothing.
 *
 * `Partial` because two deliberate non-entries exist - the chevron family
 * (`chevron`, `chevronDown/Up/Left/Right`, `back`) draws from `CHEVRON_PATH`
 * through `CHEVRON_DIR` and never reaches this map; `starOutline` is the FILL0
 * half of `star`, swapped in below and not a legal call-site name (see
 * `icon-names.ts`); `gitHub` is the runtime alias installed below. That every
 * REMAINING name has geometry is the catalog test's half of the contract.
 */
const ICONS: Partial<Record<KnownIconName | 'starOutline' | 'gitHub', string>> = {
  // Official Material Symbols Outlined local_activity (coupon/ticket).
  localActivity:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="m368-320 112-84 110 84-42-136 112-88H524l-44-136-44 136H300l110 88-42 136ZM160-160q-33 0-56.5-23.5T80-240v-135q0-11 7-19t18-10q24-8 39.5-29t15.5-47q0-26-15.5-47T105-556q-11-2-18-10t-7-19v-135q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v135q0 11-7 19t-18 10q-24 8-39.5 29T800-480q0 26 15.5 47t39.5 29q11 2 18 10t7 19v135q0 33-23.5 56.5T800-160H160Zm0-80h640v-102q-37-22-58.5-58.5T720-480q0-43 21.5-79.5T800-618v-102H160v102q37 22 58.5 58.5T240-480q0 43-21.5 79.5T160-342v102Zm320-240Z"/></svg>',
  allInbox:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M320-320h480v-120H698q-21 37-58 58.5T560-360q-42 0-79-21.5T422-440H320v120Zm240-120q34 0 57-23.5t23-56.5h160v-280H320v280h160q0 33 23.5 56.5T560-440ZM320-240q-33 0-56.5-23.5T240-320v-480q0-33 23.5-56.5T320-880h480q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H320ZM160-80q-33 0-56.5-23.5T80-160v-560h80v560h560v80H160Zm160-240h480-480Z"/></svg>',
  analytics:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M284-277h60v-205h-60v205Zm332 0h60v-420h-60v420Zm-166 0h60v-118h-60v118Zm0-205h60v-60h-60v60ZM180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm0-60h600v-600H180v600Zm0-600v600-600Z"/></svg>',
  automation:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M283-272q-40 34-83.5 30.5T124-272q-32-27-42.5-69.5T98-429l82-137q-27-21-43-52.63-16-31.64-16-68.37 0-63.53 45-108.76Q211-841 275-841t109 45q45 45 45 109t-45.24 109Q338.52-533 275-533q-10.8 0-21.6-1.5T233-539l-84 141q-14 23-8.82 45.11 5.17 22.1 22 36Q179-303 201.5-301.5T244-317l433-372q40-34 84-31t76 30q32 27 42.5 70T863-532l-81 137q27 21 43 52.63 16 31.64 16 68.37 0 63.52-45.54 108.76Q749.91-120 685.96-120 622-120 577.5-165.24 533-210.48 533-274t44.5-108.76Q622-428 686-428q10.73 0 20.87 1 10.13 1 20.13 4l84-140q14-23 8.82-45.11-5.17-22.1-22-36Q781-658 758.5-659.5T716-644L283-272Zm58.5-348.66q27.5-27.66 27.5-66.5t-27.66-66.34q-27.66-27.5-66.5-27.5t-66.34 27.66q-27.5 27.66-27.5 66.5t27.66 66.34q27.66 27.5 66.5 27.5t66.34-27.66Zm411.63 413Q781-235.32 781-274.16t-27.87-66.34q-27.86-27.5-67-27.5Q647-368 620-340.34q-27 27.66-27 66.5t27 66.34q27 27.5 66.13 27.5 39.14 0 67-27.66ZM275-687Zm412 413Z"/></svg>',
  archive:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="m480-270 156-156-40-40-86 86v-201h-60v201l-86-86-40 40 156 156ZM180-674v494h600v-494H180Zm0 554q-24.75 0-42.37-17.63Q120-155.25 120-180v-529q0-9.88 3-19.06 3-9.18 9-16.94l52-71q8-11 20.94-17.5Q217.88-840 232-840h495q14.12 0 27.06 6.5T775-816l53 71q6 7.76 9 16.94 3 9.18 3 19.06v529q0 24.75-17.62 42.37Q804.75-120 780-120H180Zm17-614h565l-36.41-46H233l-36 46Zm283 307Z"/></svg>',
  autoRenew:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M196-331q-20-36-28-72.5t-8-74.5q0-131 94.5-225.5T480-798h43l-80-80 39-39 149 149-149 149-40-40 79-79h-41q-107 0-183.5 76.5T220-478q0 29 5.5 55t13.5 49l-43 43ZM476-40 327-189l149-149 39 39-80 80h45q107 0 183.5-76.5T740-479q0-29-5-55t-15-49l43-43q20 36 28.5 72.5T800-479q0 131-94.5 225.5T480-159h-45l80 80-39 39Z"/></svg>',
  barChart:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M660-160v-280h140v280H660Zm-250 0v-640h140v640H410Zm-250 0v-440h140v440H160Z"/></svg>',
  notifications:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M160-200v-60h80v-304q0-84 49.5-150.5T420-798v-22q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v22q81 17 130.5 83.5T720-564v304h80v60H160Zm320-302Zm0 422q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80ZM300-260h360v-304q0-75-52.5-127.5T480-744q-75 0-127.5 52.5T300-564v304Z"/></svg>',
  notificationsOff:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M160-200v-60h80v-304q0-33 8.25-65T273-690l45 45q-9 19-13.5 39.46T300-564v304h319L75-805l42-42 726 727-42 42-122-122H160Zm560-129-60-60v-175q0-75-52.5-127.5T480-744q-35.14 0-67.57 13Q380-718 356-693l-46-45q23-23 50.5-38t59.5-22v-22q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v22q81 17 130.5 83.5T720-564v235Zm-260-91Zm20 340q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80Zm28-461Z"/></svg>',
  check:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M378-246 154-470l43-43 181 181 384-384 43 43-427 427Z"/></svg>',
  checkCircle:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="m421-298 283-283-46-45-237 237-120-120-45 45 165 166Zm59 218q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-156t86-127Q252-817 325-848.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 82-31.5 155T763-197.5q-54 54.5-127 86T480-80Zm0-60q142 0 241-99.5T820-480q0-142-99-241t-241-99q-141 0-240.5 99T140-480q0 141 99.5 240.5T480-140Zm0-340Z"/></svg>',
  checkBox:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="m419-321 289-289-43-43-246 246-119-119-43 43 162 162ZM180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm0-60h600v-600H180v600Zm0-600v600-600Z"/></svg>',
  checkBoxOutlineBlank:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm0-60h600v-600H180v600Z"/></svg>',
  schedule:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="m627-287 45-45-159-160v-201h-60v225l174 181ZM480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-82 31.5-155t86-127.5Q252-817 325-848.5T480-880q82 0 155 31.5t127.5 86Q817-708 848.5-635T880-480q0 82-31.5 155t-86 127.5Q708-143 635-111.5T480-80Zm0-400Zm0 340q140 0 240-100t100-240q0-140-100-240T480-820q-140 0-240 100T140-480q0 140 100 240t240 100Z"/></svg>',
  contentCopy:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M300-200q-24 0-42-18t-18-42v-560q0-24 18-42t42-18h440q24 0 42 18t18 42v560q0 24-18 42t-42 18H300Zm0-60h440v-560H300v560ZM180-80q-24 0-42-18t-18-42v-620h60v620h500v60H180Zm120-180v-560 560Z"/></svg>',
  database:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M480-120q-151 0-255.5-46.5T120-280v-400q0-66 105.5-113T480-840q149 0 254.5 47T840-680v400q0 67-104.5 113.5T480-120Zm0-488q86 0 176.5-26.5T773-694q-27-32-117.5-59T480-780q-88 0-177 26t-117 60q28 35 116 60.5T480-608Zm-1 214q42 0 84-4.5t80.5-13.5q38.5-9 73.5-22t63-29v-155q-29 16-64 29t-74 22q-39 9-80 14t-83 5q-42 0-84-5t-80.5-14q-38.5-9-73-22T180-618v155q27 16 61 29t72.5 22q38.5 9 80.5 13.5t85 4.5Zm1 214q48 0 99-8.5t93.5-22.5q42.5-14 72-31t35.5-35v-125q-28 16-63 28.5T643.5-352q-38.5 9-80 13.5T479-334q-43 0-85-4.5T313.5-352q-38.5-9-72.5-21.5T180-402v126q5 17 34 34.5t72 31q43 13.5 94 22t100 8.5Z"/></svg>',
  download:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M480-313 287-506l43-43 120 120v-371h60v371l120-120 43 43-193 193ZM220-160q-24 0-42-18t-18-42v-143h60v143h520v-143h60v143q0 24-18 42t-42 18H220Z"/></svg>',
  upload:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M450-313v-371L330-564l-43-43 193-193 193 193-43 43-120-120v371h-60ZM220-160q-24 0-42-18t-18-42v-143h60v143h520v-143h60v143q0 24-18 42t-42 18H220Z"/></svg>',
  downloadForOffline:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M280-280h400v-60H280v60Zm197-126 158-157-42-42-85 84v-199h-60v199l-85-84-42 42 156 157Zm3 326q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-156t86-127Q252-817 325-848.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 82-31.5 155T763-197.5q-54 54.5-127 86T480-80Zm0-60q142 0 241-99.5T820-480q0-142-99-241t-241-99q-141 0-240.5 99T140-480q0 141 99.5 240.5T480-140Zm0-340Z"/></svg>',
  edit: '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M180-180h44l472-471-44-44-472 471v44Zm-60 60v-128l575-574q8-8 19-12.5t23-4.5q11 0 22 4.5t20 12.5l44 44q9 9 13 20t4 22q0 11-4.5 22.5T823-694L248-120H120Zm659-617-41-41 41 41Zm-105 64-22-22 44 44-22-22Z"/></svg>',
  editSquare:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h405l-60 60H180v600h600v-348l60-60v408q0 24-18 42t-42 18H180Zm300-360ZM360-360v-170l382-382q9-9 20-13t22-4q11 0 22.32 4.5Q817.63-920 827-911l83 84q8.61 8.96 13.3 19.78 4.7 10.83 4.7 22.02 0 11.2-4.5 22.7T910-742L530-360H360Zm508-425-84-84 84 84ZM420-420h85l253-253-43-42-43-42-252 251v86Zm295-295-43-42 43 42 43 42-43-42Z"/></svg>',
  expand:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M120-120v-300h60v198l558-558H540v-60h300v300h-60v-198L222-180h198v60H120Z"/></svg>',
  openInNew:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h560v-280h80v280q0 33-23.5 56.5T760-120H200Zm188-212-56-56 372-372H600v-80h240v240h-80v-104L388-332Z"/></svg>',
  filter:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M440-160q-17 0-28.5-11.5T400-200v-240L161-745q-14-17-4-36t31-19h584q21 0 31 19t-4 36L560-440v240q0 17-11.5 28.5T520-160h-80Zm40-276 240-304H240l240 304Zm0 0Z"/></svg>',
  localFireDepartment:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M220-400q0 63 28.5 118.5T328-189q-4-12-6-24.5t-2-24.5q0-32 12-60t35-51l113-111 113 111q23 23 35 51t12 60q0 12-2 24.5t-6 24.5q51-37 79.5-92.5T740-400q0-54-23-105.5T651-600q-21 15-44 23.5t-46 8.5q-61 0-101-41.5T420-714v-20q-46 33-83 73t-63 83.5q-26 43.5-40 89T220-400Zm260 24-71 70q-14 14-21.5 31t-7.5 37q0 41 29 69.5t71 28.5q42 0 71-28.5t29-69.5q0-20-7.5-37T551-306l-71-70Zm0-464v132q0 34 23.5 57t57.5 23q18 0 33.5-7.5T622-658l18-22q74 42 117 117t43 163q0 134-93 227T480-80q-134 0-227-93t-93-227q0-128 86-246.5T480-840Z"/></svg>',
  forward:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="m644-288-43-43 193-193-193-193 43-43 236 236-236 236ZM81-200v-156q0-85 56.5-141.5T279-554h305L421-717l43-43 236 236-236 236-43-43 163-163H279q-60 0-99 39t-39 99v156H81Z"/></svg>',
  globe:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M324-111.5Q251-143 197-197t-85.5-127Q80-397 80-480t31.5-156Q143-709 197-763t127-85.5Q397-880 480-880t156 31.5Q709-817 763-763t85.5 127Q880-563 880-480t-31.5 156Q817-251 763-197t-127 85.5Q563-80 480-80t-156-31.5ZM437-141v-82q-35 0-59-26t-24-61v-44L149-559q-5 20-7 39.5t-2 39.5q0 130 84.5 227T437-141Zm294-108q44-48 66.5-107.5T820-480q0-106-58-192.5T607-799v18q0 35-24 61t-59 26h-87v87q0 17-13.5 28T393-568h-83v88h258q17 0 28 13t11 30v127h43q29 0 51 17t30 44Z"/></svg>',
  github:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.726-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.757-1.333-1.757-1.09-.745.083-.73.083-.73 1.205.085 1.84 1.237 1.84 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.418-1.305.76-1.605-2.665-.303-5.467-1.333-5.467-5.93 0-1.31.468-2.382 1.236-3.222-.124-.303-.536-1.523.117-3.176 0 0 1.008-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.29-1.552 3.297-1.23 3.297-1.23.655 1.653.243 2.873.12 3.176.77.84 1.235 1.912 1.235 3.222 0 4.61-2.807 5.625-5.48 5.922.43.372.814 1.103.814 2.222 0 1.606-.015 2.898-.015 3.293 0 .32.216.694.825.576C20.565 21.796 24 17.297 24 12 24 5.37 18.63 0 12 0z"/></svg>',
  gridView:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M120-510v-330h330v330H120Zm0 390v-330h330v330H120Zm390-390v-330h330v330H510Zm0 390v-330h330v330H510ZM180-570h210v-210H180v210Zm390 0h210v-210H570v210Zm0 390h210v-210H570v210Zm-390 0h210v-210H180v210Zm390-390Zm0 180Zm-180 0Zm0-180Z"/></svg>',
  dragHandle:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M160-390v-60h640v60H160Zm0-120v-60h640v60H160Z"/></svg>',
  moreHoriz:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M207.86-432Q188-432 174-446.14t-14-34Q160-500 174.14-514t34-14Q228-528 242-513.86t14 34Q256-460 241.86-446t-34 14Zm272 0Q460-432 446-446.14t-14-34Q432-500 446.14-514t34-14Q500-528 514-513.86t14 34Q528-460 513.86-446t-34 14Zm272 0Q732-432 718-446.14t-14-34Q704-500 718.14-514t34-14Q772-528 786-513.86t14 34Q800-460 785.86-446t-34 14Z"/></svg>',
  moreVert:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M479.86-160Q460-160 446-174.14t-14-34Q432-228 446.14-242t34-14Q500-256 514-241.86t14 34Q528-188 513.86-174t-34 14Zm0-272Q460-432 446-446.14t-14-34Q432-500 446.14-514t34-14Q500-528 514-513.86t14 34Q528-460 513.86-446t-34 14Zm0-272Q460-704 446-718.14t-14-34Q432-772 446.14-786t34-14Q500-800 514-785.86t14 34Q528-732 513.86-718t-34 14Z"/></svg>',
  mic: '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M408-453.92q-29-30.91-29-75.08v-251q0-41.67 29.44-70.83Q437.88-880 479.94-880t71.56 29.17Q581-821.67 581-780v251q0 44.17-29 75.08Q523-423 480-423t-72-30.92ZM480-651Zm-30 531v-136q-106-11-178-89t-72-184h60q0 91 64.29 153t155.5 62q91.21 0 155.71-62Q700-438 700-529h60q0 106-72 184t-178 89v136h-60Zm59.5-376.5Q521-510 521-529v-251q0-17-11.79-28.5T480-820q-17.42 0-29.21 11.5T439-780v251q0 19 11.5 32.5T480-483q18 0 29.5-13.5Z"/></svg>',
  chrome:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path stroke-linecap="round" d="M12 3v5.5M4.2 16.5l4.8-2.8M19.8 16.5l-4.8-2.8"/></svg>',
  firefox:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path fill="currentColor" stroke="none" d="M6 17.5c4 .5 8-1.5 9.5-5.5-1.5.3-2.8.1-3.9-.6.4-1.7 1.3-3 2.9-3.9-2.6-.4-5.3.5-7 2.3C5.8 11.6 5 14.4 6 17.5z"/></svg>',
  edge: '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M20 10a8.5 8.5 0 1 0 .5 5"/><line x1="3.5" y1="12.5" x2="15" y2="12.5"/><path stroke-linecap="round" d="M15 12.5a3 3 0 0 1-5.7 1.3"/></svg>',
  safari:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path fill="currentColor" stroke="none" d="M15.8 8.2l-2.3 5.3-5.3 2.3 2.3-5.3z"/></svg>',
  key: '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M280-240q-100 0-170-70T40-480q0-100 70-170t170-70q78 0 131.5 37.5T491-583h429v206H814v137H628v-137H491q-26 62-79.5 99.5T280-240Zm0-60q71 0 116.5-47t53.5-90h242v137h62v-137h106v-86H450q-8-43-53.5-90T280-660q-75 0-127.5 52.5T100-480q0 75 52.5 127.5T280-300Zm0-112q29 0 48.5-19.5T348-480q0-29-19.5-48.5T280-548q-29 0-48.5 19.5T212-480q0 29 19.5 48.5T280-412Zm0-68Z"/></svg>',
  inbox:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm0-60h600v-136H634q-26 40-67.5 61.5T480-233q-45 0-86.5-21.5T326-316H180v136Zm374-136.5q33-23.5 56-59.5h170v-404H180v404h170q23 36 56.25 59.5 33.24 23.5 74 23.5Q521-293 554-316.5ZM180-180h600-600Z"/></svg>',
  contactPage:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M480-400q33 0 56.5-23.5T560-480q0-33-23.5-56.5T480-560q-33 0-56.5 23.5T400-480q0 33 23.5 56.5T480-400ZM320-240h320v-23q0-24-13-44t-36-30q-26-11-53.5-17t-57.5-6q-30 0-57.5 6T369-337q-23 10-36 30t-13 44v23ZM720-80H240q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80Zm0-80v-446L526-800H240v640h480Zm-480 0v-640 640Z"/></svg>',
  info: '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M453-280h60v-240h-60v240Zm50.5-323.2q9.5-9.2 9.5-22.8 0-14.45-9.48-24.22-9.48-9.78-23.5-9.78t-23.52 9.78Q447-640.45 447-626q0 13.6 9.48 22.8 9.48 9.2 23.5 9.2t23.52-9.2ZM480.27-80q-82.74 0-155.5-31.5Q252-143 197.5-197.5t-86-127.34Q80-397.68 80-480.5t31.5-155.66Q143-709 197.5-763t127.34-85.5Q397.68-880 480.5-880t155.66 31.5Q709-817 763-763t85.5 127Q880-563 880-480.27q0 82.74-31.5 155.5Q817-252 763-197.68q-54 54.31-127 86Q563-80 480.27-80Zm.23-60Q622-140 721-239.5t99-241Q820-622 721.19-721T480-820q-141 0-240.5 98.81T140-480q0 141 99.5 240.5t241 99.5Zm-.5-340Z"/></svg>',
  layers:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M480-130 120-410l50-37 310 241 310-241 50 37-360 280Zm0-152L120-562l360-280 360 280-360 280Zm0-301Zm0 225 262-204-262-204-262 204 262 204Z"/></svg>',
  link: '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M450-280H280q-83 0-141.5-58.5T80-480q0-83 58.5-141.5T280-680h170v60H280q-58.33 0-99.17 40.76-40.83 40.77-40.83 99Q140-422 180.83-381q40.84 41 99.17 41h170v60ZM325-450v-60h310v60H325Zm185 170v-60h170q58.33 0 99.17-40.76 40.83-40.77 40.83-99Q820-538 779.17-579q-40.84-41-99.17-41H510v-60h170q83 0 141.5 58.5T880-480q0 83-58.5 141.5T680-280H510Z"/></svg>',
  lock: '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M220-80q-24.75 0-42.37-17.63Q160-115.25 160-140v-434q0-24.75 17.63-42.38Q195.25-634 220-634h70v-96q0-78.85 55.61-134.42Q401.21-920 480.11-920q78.89 0 134.39 55.58Q670-808.85 670-730v96h70q24.75 0 42.38 17.62Q800-598.75 800-574v434q0 24.75-17.62 42.37Q764.75-80 740-80H220Zm0-60h520v-434H220v434Zm314.5-162.03Q557-324.06 557-355q0-30-22.67-54.5t-54.5-24.5q-31.83 0-54.33 24.5t-22.5 55q0 30.5 22.67 52.5t54.5 22q31.83 0 54.33-22.03ZM350-634h260v-96q0-54.17-37.88-92.08-37.88-37.92-92-37.92T388-822.08q-38 37.91-38 92.08v96ZM220-140v-434 434Z"/></svg>',
  person:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M372-523q-42-42-42-108t42-108q42-42 108-42t108 42q42 42 42 108t-42 108q-42 42-108 42t-108-42ZM160-160v-94q0-38 19-65t49-41q67-30 128.5-45T480-420q62 0 123 15.5T731-360q31 14 50 41t19 65v94H160Zm60-60h520v-34q0-16-9.5-30.5T707-306q-64-31-117-42.5T480-360q-57 0-111 11.5T252-306q-14 7-23 21.5t-9 30.5v34Zm324.5-346.5Q570-592 570-631t-25.5-64.5Q519-721 480-721t-64.5 25.5Q390-670 390-631t25.5 64.5Q441-541 480-541t64.5-25.5ZM480-631Zm0 411Z"/></svg>',
  print:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M658-648v-132H302v132h-60v-192h476v192h-60Zm-518 60h680-680Zm599 95q12 0 21-9t9-21q0-12-9-21t-21-9q-12 0-21 9t-9 21q0 12 9 21t21 9Zm-81 313v-192H302v192h356Zm60 60H242v-176H80v-246q0-45.05 30.5-75.53Q141-648 186-648h588q45.05 0 75.53 30.47Q880-587.05 880-542v246H718v176Zm102-236v-186.21Q820-562 806.78-575q-13.23-13-32.78-13H186q-19.55 0-32.77 13.22Q140-561.55 140-542v186h102v-76h476v76h102Z"/></svg>',
  mail: '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M140-160q-24 0-42-18t-18-42v-520q0-24 18-42t42-18h680q24 0 42 18t18 42v520q0 24-18 42t-42 18H140Zm340-302L140-685v465h680v-465L480-462Zm0-60 336-218H145l335 218ZM140-685v-55 520-465Z"/></svg>',
  mark_email_read:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M633-80 472-241l43-43 118 118 244-244 43 43L633-80ZM478-527l334-213H144l334 213Zm0 60L140-684v452h256l60 60H140q-24 0-42-18t-18-42v-508q0-24 18-42t42-18h677q24 0 42 18t18 42v244l-60 60v-248L478-467Zm1 9Zm-1-69Zm1 60Z"/></svg>',
  mark_email_unread:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M140-160q-24 0-42-18t-18-42v-520q0-24 18-42t42-18h434q-3 15-4 30t1 30H145l335 218 151-98q10 9 21 16.67 11 7.68 23 13.33L480-462 140-685v465h680v-360q16.79-4.78 31.4-13.39Q866-602 880-613v393q0 24-18 42t-42 18H140Zm0-580v520-520Zm542 57.88q-32-32.12-32-78T682.12-838q32.12-32 78-32T838-837.88q32 32.12 32 78T837.88-682q-32.12 32-78 32T682-682.12Z"/></svg>',
  monitor:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M260-120v-73l47-47H140q-24 0-42-18t-18-42v-480q0-24 18-42t42-18h680q24 0 42 18t18 42v480q0 24-18 42t-42 18H652l48 47v73H260ZM140-300h680v-480H140v480Zm0 0v-480 480Z"/></svg>',
  darkMode:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M480-120q-150 0-255-105T120-480q0-150 105-255t255-105q8 0 17 .5t23 1.5q-36 32-56 79t-20 99q0 90 63 153t153 63q52 0 99-18.5t79-51.5q1 12 1.5 19.5t.5 14.5q0 150-105 255T480-120Zm0-60q109 0 190-67.5T771-406q-25 11-53.67 16.5Q688.67-384 660-384q-114.69 0-195.34-80.66Q384-545.31 384-660q0-24 5-51.5t18-62.5q-98 27-162.5 109.5T180-480q0 125 87.5 212.5T480-180Zm-4-297Z"/></svg>',
  add: '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M450-450H200v-60h250v-250h60v250h250v60H510v250h-60v-250Z"/></svg>',
  radioButtonChecked:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M612-348q54-54 54-132t-54-132q-54-54-132-54t-132 54q-54 54-54 132t54 132q54 54 132 54t132-54ZM480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-156t86-127Q252-817 325-848.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 82-31.5 155T763-197.5q-54 54.5-127 86T480-80Zm0-60q142 0 241-99.5T820-480q0-142-99-241t-241-99q-141 0-240.5 99T140-480q0 141 99.5 240.5T480-140Z"/></svg>',
  radioButtonUnchecked:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-156t86-127Q252-817 325-848.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 82-31.5 155T763-197.5q-54 54.5-127 86T480-80Zm0-60q142 0 241-99.5T820-480q0-142-99-241t-241-99q-141 0-240.5 99T140-480q0 141 99.5 240.5T480-140Z"/></svg>',
  qrCode2:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M520-120v-80h80v80h-80Zm-80-80v-200h80v200h-80Zm320-120v-160h80v160h-80Zm-80-160v-80h80v80h-80Zm-480 80v-80h80v80h-80Zm-80-80v-80h80v80h-80Zm360-280v-80h80v80h-80ZM170-650h140v-140H170v140Zm-50 50v-240h240v240H120Zm50 430h140v-140H170v140Zm-50 50v-240h240v240H120Zm530-530h140v-140H650v140Zm-50 50v-240h240v240H600Zm80 480v-120h-80v-80h160v120h80v80H680ZM520-400v-80h160v80H520Zm-160 0v-80h-80v-80h240v80h-80v80h-80Zm40-200v-160h80v80h80v80H400Zm-190-90v-60h60v60h-60Zm0 480v-60h60v60h-60Zm480-480v-60h60v60h-60Z"/></svg>',
  refresh:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M480-160q-133 0-226.5-93.5T160-480q0-133 93.5-226.5T480-800q85 0 149 34.5T740-671v-129h60v254H546v-60h168q-38-60-97-97t-137-37q-109 0-184.5 75.5T220-480q0 109 75.5 184.5T480-220q83 0 152-47.5T728-393h62q-29 105-115 169t-195 64Z"/></svg>',
  search:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M796-121 533-384q-30 26-70 40.5T378-329q-108 0-183-75t-75-181q0-106 75-181t182-75q106 0 180.5 75T632-585q0 43-14 83t-42 75l264 262-44 44ZM377-389q81 0 138-57.5T572-585q0-81-57-138.5T377-781q-82 0-139.5 57.5T180-585q0 81 57.5 138.5T377-389Z"/></svg>',
  settings:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="m388-80-20-126q-19-7-40-19t-37-25l-118 54-93-164 108-79q-2-9-2.5-20.5T185-480q0-9 .5-20.5T188-521L80-600l93-164 118 54q16-13 37-25t40-18l20-127h184l20 126q19 7 40.5 18.5T669-710l118-54 93 164-108 77q2 10 2.5 21.5t.5 21.5q0 10-.5 21t-2.5 21l108 78-93 164-118-54q-16 13-36.5 25.5T592-206L572-80H388Zm48-60h88l14-112q33-8 62.5-25t53.5-41l106 46 40-72-94-69q4-17 6.5-33.5T715-480q0-17-2-33.5t-7-33.5l94-69-40-72-106 46q-23-26-52-43.5T538-708l-14-112h-88l-14 112q-34 7-63.5 24T306-642l-106-46-40 72 94 69q-4 17-6.5 33.5T245-480q0 17 2.5 33.5T254-413l-94 69 40 72 106-46q24 24 53.5 41t62.5 25l14 112Zm44-210q54 0 92-38t38-92q0-54-38-92t-92-38q-54 0-92 38t-38 92q0 54 38 92t92 38Zm0-130Z"/></svg>',
  shield:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M480-81q-140-35-230-162.5T160-523v-238l320-120 320 120v238q0 152-90 279.5T480-81Zm0-62q115-38 187.5-143.5T740-523v-196l-260-98-260 98v196q0 131 72.5 236.5T480-143Zm0-337Z"/></svg>',
  star: '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="m233-120 65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149-247 149Z"/></svg>',
  /** Outlined (FILL0) variant - hollow look comes from the glyph shape, not stroke. */
  starOutline:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="m354-287 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143ZM233-120l65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149-247 149Zm247-350Z"/></svg>',
  lightMode:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M579-381q41-41 41-99t-41-99q-41-41-99-41t-99 41q-41 41-41 99t41 99q41 41 99 41t99-41Zm-240.5 42.5Q280-397 280-480t58.5-141.5Q397-680 480-680t141.5 58.5Q680-563 680-480t-58.5 141.5Q563-280 480-280t-141.5-58.5ZM200-450H40v-60h160v60Zm720 0H760v-60h160v60ZM450-760v-160h60v160h-60Zm0 720v-160h60v160h-60ZM262-658l-100-97 43-44 96 100-39 41Zm494 496-98-100 41-41 99 98-42 43Zm-99-537 98-99 44 42-99 98-43-41ZM162-205l99-98 42 42-98 99-43-43Zm318-275Z"/></svg>',
  tag: '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="m239-160 40-159H120l15-60h159l51-202H186l15-60h159l39-159h59l-39 159h203l39-159h59l-39 159h159l-15 60H666l-51 202h159l-15 60H600l-40 159h-59l40-159H338l-40 159h-59Zm114-219h203l51-202H404l-51 202Z"/></svg>',
  threads:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M880-81 721-240H300q-24.75 0-42.37-17.63Q240-275.25 240-300v-80h440q24.75 0 42.38-17.63Q740-415.25 740-440v-280h80q24.75 0 42.38 17.62Q880-684.75 880-660v579ZM140-425l75-75h405v-320H140v395ZM80-280v-540q0-24.75 17.63-42.38Q115.25-880 140-880h480q24.75 0 42.38 17.62Q680-844.75 680-820v320q0 24.75-17.62 42.37Q644.75-440 620-440H240L80-280Zm60-220v-320 320Z"/></svg>',
  delete:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M261-120q-24.75 0-42.37-17.63Q201-155.25 201-180v-570h-41v-60h188v-30h264v30h188v60h-41v570q0 24-18 42t-42 18H261Zm438-630H261v570h438v-570ZM367-266h60v-399h-60v399Zm166 0h60v-399h-60v399ZM261-750v570-570Z"/></svg>',
  unarchive:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M480-581 324-425l40 40 86-86v201h60v-201l86 86 40-40-156-156Zm-300-93v494h600v-494H180Zm0 554q-24.75 0-42.37-17.63Q120-155.25 120-180v-529q0-9.88 3-19.06 3-9.18 9-16.94l52-71q8-11 20.94-17.5Q217.88-840 232-840h495q14.12 0 27.06 6.5T775-816l53 71q6 7.76 9 16.94 3 9.18 3 19.06v529q0 24.75-17.62 42.37Q804.75-120 780-120H180Zm17-614h565l-36.41-46H233l-36 46Zm283 307Z"/></svg>',
  warning:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="m40-120 440-760 440 760H40Zm104-60h672L480-760 144-180Zm361.5-65.68q8.5-8.67 8.5-21.5 0-12.82-8.68-21.32-8.67-8.5-21.5-8.5-12.82 0-21.32 8.68-8.5 8.67-8.5 21.5 0 12.82 8.68 21.32 8.67 8.5 21.5 8.5 12.82 0 21.32-8.68ZM454-348h60v-224h-60v224Zm26-122Z"/></svg>',
  wifiOff:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M805-69 411-463q-54 13-99.5 42T232-357l-63-63q37-37 76.5-65t94.5-50L229-646q-47 23-89 54.5T63-526L0-589q36-37 77-69t84-55l-92-92 43-43 736 736-43 43Zm-388-85q-27-27-27-63t27-63q27-27 63-27t63 27q27 27 27 63t-27 63q-27 27-63 27t-63-27Zm311-203q-33-32-60-51.5T599-447L486-560q95 2 167.5 39T791-420l-63 63Zm169-169q-88-84-192.5-134T480-710q-37 0-71 4.5T352-693l-73-73q44-16 95.5-25t105.5-9q140 0 263.5 58T960-589l-63 63Z"/></svg>',
  cloudOff:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M792-56 686-160H260q-92 0-156-64T40-380q0-77 47.5-137T210-594q3-8 6-15.5t6-16.5L56-792l56-56 736 736-56 56ZM260-240h346L284-562q-2 11-3 21t-1 21h-20q-58 0-99 41t-41 99q0 58 41 99t99 41Zm185-161Zm419 191-58-56q17-14 25.5-32.5T840-340q0-42-29-71t-71-29h-60v-80q0-83-58.5-141.5T480-720q-27 0-52 6.5T380-693l-58-58q35-24 74.5-36.5T480-800q117 0 198.5 81.5T760-520q69 8 114.5 59.5T920-340q0 39-15 72.5T864-210ZM593-479Z"/></svg>',
  keep: '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="m640-480 80 80v80H520v240l-40 40-40-40v-240H240v-80l80-80v-280h-40v-80h400v80h-40v280Zm-286 80h252l-46-46v-314H400v314l-46 46Zm126 0Z"/></svg>',
  keepOff:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M680-840v80h-40v327l-80-80v-247H400v87l-87-87-33-33v-47h400ZM480-40l-40-40v-240H240v-80l80-80v-46L56-792l56-56 736 736-58 56-264-264h-6v240l-40 40ZM354-400h92l-44-44-2-2-46 46Zm126-193Zm-78 149Z"/></svg>',
  close:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="m249-207-42-42 231-231-231-231 42-42 231 231 231-231 42 42-231 231 231 231-42 42-231-231-231 231Z"/></svg>',
  visibility:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M480-320q75 0 127.5-52.5T660-500q0-75-52.5-127.5T480-680q-75 0-127.5 52.5T300-500q0 75 52.5 127.5T480-320Zm0-72q-45 0-76.5-31.5T372-500q0-45 31.5-76.5T480-608q45 0 76.5 31.5T588-500q0 45-31.5 76.5T480-392Zm0 192q-146 0-266-81.5T40-500q54-137 174-218.5T480-800q146 0 266 81.5T920-500q-54 137-174 218.5T480-200Zm0-300Zm0 220q113 0 207.5-59.5T832-500q-50-101-144.5-160.5T480-720q-113 0-207.5 59.5T128-500q50 101 144.5 160.5T480-280Z"/></svg>',
  visibilityOff:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="m644-428-58-58q9-47-27-88t-93-32l-58-58q17-8 34.5-12t37.5-4q75 0 127.5 52.5T660-500q0 20-4 37.5T644-428Zm128 126-58-56q38-29 67.5-63.5T832-500q-50-101-143.5-160.5T480-720q-29 0-57 4t-55 12l-62-62q41-17 84-25.5t90-8.5q151 0 269 83.5T920-500q-23 59-60.5 109.5T772-302Zm20 246L624-222q-35 11-70.5 16.5T480-200q-151 0-269-83.5T40-500q21-53 53-98.5t73-81.5L56-792l56-56 736 736-56 56ZM222-624q-29 26-53 57t-41 67q50 101 143.5 160.5T480-280q20 0 39-2.5t39-5.5l-36-38q-11 3-21 4.5t-21 1.5q-75 0-127.5-52.5T300-500q0-11 1.5-21t4.5-21l-84-82Zm319 93Zm-151 75Z"/></svg>',
  description:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z"/></svg>',
  image:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm40-80h480L570-480 450-320l-90-120-120 160Zm-40 80v-560 560Z"/></svg>',
  code: '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M320-240 80-480l240-240 57 57-184 184 183 183-56 56Zm320 0-57-57 184-184-183-183 56-56 240 240-240 240Z"/></svg>',
  headphones:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M360-120H200q-33 0-56.5-23.5T120-200v-280q0-75 28.5-140.5t77-114q48.5-48.5 114-77T480-840q75 0 140.5 28.5t114 77q48.5 48.5 77 114T840-480v280q0 33-23.5 56.5T760-120H600v-320h160v-40q0-117-81.5-198.5T480-760q-117 0-198.5 81.5T200-480v40h160v320Zm-80-240h-80v160h80v-160Zm400 0v160h80v-160h-80Zm-400 0h-80 80Zm400 0h80-80Z"/></svg>',
  videocam:
    '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h480q33 0 56.5 23.5T720-720v180l160-160v440L720-420v180q0 33-23.5 56.5T640-160H160Zm0-80h480v-480H160v480Zm0 0v-480 480Z"/></svg>',
  box: '<svg xmlns="http://www.w3.org/2000/svg" class="{className}" viewBox="0 -960 960 960" fill="currentColor"><path d="M200-640v440h560v-440H640v320l-160-80-160 80v-320H200Zm0 520q-33 0-56.5-23.5T120-200v-499q0-14 4.5-27t13.5-24l50-61q11-14 27.5-21.5T250-840h460q18 0 34.5 7.5T772-811l50 61q9 11 13.5 24t4.5 27v499q0 33-23.5 56.5T760-120H200Zm16-600h528l-34-40H250l-34 40Zm184 80v190l80-40 80 40v-190H400Zm-200 0h560-560Z"/></svg>',
};

// Legacy alias: 'gitHub' → 'github' (kept for backwards-compat, no duplicate SVG)
ICONS.gitHub = ICONS.github;

/**
 * Probe trace, off in production - see `tests/e2e/icon-render.e2e.ts`.
 *
 * That probe walks every surface of the BUILT extension and asserts no icon is
 * blank. It can measure a glyph that paints nothing, but not one that was never
 * rendered at all: an unresolvable name returns `''` below, which leaves no node
 * to find (the five blank icons the catalog rename shipped were exactly this).
 * Setting `__ICON_PROBE__` before the bundle runs makes both halves visible
 * without changing what ships:
 *
 *   - every glyph that DOES render carries `data-icon="…"`, so the probe can name
 *     what it inspected - and fail loudly when the flag never reached the bundle,
 *     because zero tagged icons and a clean run are otherwise indistinguishable;
 *   - a name that resolves to nothing leaves a zero-size `data-icon-missing`
 *     marker instead of silence.
 *
 * With the flag unset the markup is byte-for-byte what it was, and the probe
 * asserts that too (a page loaded without the flag has no `[data-icon]` at all).
 * Same handle idea as `data-tag-chip` / `data-chosen`, gated because a marker for
 * a FAILING icon must never ship to users.
 */
const ICON_PROBE = (globalThis as { __ICON_PROBE__?: unknown }).__ICON_PROBE__ === true;

/** A name is developer-written, but it is still interpolated into HTML here. */
function probeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

let html = $derived.by(() => {
  // Shared rotatable chevron (one path for all directions). Rotation is driven
  // by a CSS variable consumed by the .icon-chevron class (see styles.css) - NOT
  // an inline transform - so `[dir="rtl"] .rtl-flip` can compose its scaleX(-1)
  // with the rotation instead of being overridden by inline specificity.
  if (name in CHEVRON_DIR || name === 'chevron') {
    // The prop is deliberately open (`IconName`), so the lookup is a cast at the
    // boundary: a name outside the catalog simply has no rotation.
    const dir = CHEVRON_DIR[name as KnownIconName] ?? 0;
    const deg = dir + (Number(rotate) || 0);
    const style = deg !== 0 ? ` style="--icon-deg:${deg}deg"` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" class="${className} icon-chevron" viewBox="0 -960 960 960" fill="currentColor"${style}>${CHEVRON_PATH}</svg>`;
  }
  // Star swaps between the official Material Symbols FILL1 (solid) and
  // FILL0 (outline) glyphs; both render with a solid currentColor fill -
  // the hollow look comes from the outline glyph's shape, never stroke.
  // Nav icons resolve through icon-variants.ts the same way (official
  // FILL1/FILL0 pairs); names without a variant pair fall back to the
  // single catalog glyph below.
  const variant = navIconVariantSvg(name, filled, className);
  if (variant) return variant;
  // Same boundary, same reason: an unknown name resolves to nothing, which the
  // icon-reference gate is what keeps honest.
  const glyph = (name === 'star' && !filled ? 'starOutline' : name) as KnownIconName;
  const svg = ICONS[glyph];
  if (!svg) return '';
  return svg.replace(/\{className\}/g, className);
});

/**
 * `html` with the probe's name attribute. Every markup branch above starts with
 * `<svg ` (the catalog literals, the chevron, and `navIconVariantSvg`'s shell),
 * so one prefix replace covers all of them.
 */
let traced = $derived(
  ICON_PROBE && html
    ? html.replace('<svg ', `<svg data-icon="${probeAttribute(String(name))}" `)
    : html
);
</script>

{#if traced}
  {@html traced}
{:else if ICON_PROBE && name}
  <!-- The blank icon: nothing renders, so the probe is given something to find. -->
  <span data-icon-missing={String(name)} hidden></span>
{/if}
