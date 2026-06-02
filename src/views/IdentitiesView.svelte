<script lang="ts">
import { onDestroy } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import DragHint from '@/components/ui/DragHint.svelte';
import FaviconImage from '@/components/ui/FaviconImage.svelte';
import {
  deleteIdentity,
  loadIdentities,
  reorderIdentities,
  saveIdentity,
  selectIdentity,
} from '@/features/identities/identity-actions.js';
import { getErrorMessage } from '@/utils/errors.js';
import { logError } from '@/utils/logger.js';
import type { CredentialsHistoryItem, Identity } from '@/utils/types.js';
import {
  validateOTP,
  validatePassword,
  validatePhoneNumber,
  validateTextInput,
} from '@/utils/validation.js';

const DEFAULT_FIRST_NAMES = [
  'James',
  'John',
  'Robert',
  'Michael',
  'William',
  'David',
  'Richard',
  'Joseph',
  'Thomas',
  'Charles',
  'Mary',
  'Patricia',
  'Jennifer',
  'Linda',
  'Elizabeth',
  'Barbara',
  'Susan',
  'Jessica',
  'Sarah',
  'Karen',
];

const DEFAULT_LAST_NAMES = [
  'Smith',
  'Johnson',
  'Williams',
  'Brown',
  'Jones',
  'Garcia',
  'Miller',
  'Davis',
  'Rodriguez',
  'Martinez',
  'Anderson',
  'Taylor',
  'Thomas',
  'Moore',
  'Jackson',
  'Martin',
  'Lee',
  'Thompson',
  'White',
  'Harris',
];

let {
  context = 'popup',
  onBack = () => {},
  savedLogins = [] as CredentialsHistoryItem[],
} = $props<{
  context?: 'popup' | 'sidepanel' | 'app';
  onBack?: () => void;
  savedLogins?: CredentialsHistoryItem[];
}>();

let identities = $state<Identity[]>([]);
let selectedIdentityId = $state<string | null>(null);
let editingIdentity = $state<Identity | null>(null);
let showCreateDialog = $state(false);
let showIdentityDropdown = $state(false);

// Multi-select state
let selectionMode = $state(false);
let selectedIds = $state<Set<string>>(new Set());
let holdTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Drag-and-drop state
let draggedIdentityId = $state<string | null>(null);
let dropTargetIdentityId = $state<string | null>(null);
let dragHintDismissed = $state(false);
function handleIdentityDragHintDismiss(): void {
  dragHintDismissed = true;
}

function handleIdentityDragStart(e: DragEvent, identityId: string) {
  if (selectionMode) {
    e.preventDefault();
    return;
  }
  draggedIdentityId = identityId;
  dragHintDismissed = true;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', identityId);
  }
}

function handleIdentityDragOver(e: DragEvent, identityId: string) {
  if (!draggedIdentityId || draggedIdentityId === identityId) return;
  e.preventDefault();
  dropTargetIdentityId = identityId;
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }
}

function handleIdentityDragLeave(identityId: string) {
  if (dropTargetIdentityId === identityId) {
    dropTargetIdentityId = null;
  }
}

async function handleIdentityDrop(e: DragEvent, targetId: string) {
  e.preventDefault();
  const sourceId = draggedIdentityId;
  draggedIdentityId = null;
  dropTargetIdentityId = null;
  if (!sourceId || sourceId === targetId) return;
  const fromIndex = identities.findIndex((i: Identity) => i.id === sourceId);
  const toIndex = identities.findIndex((i: Identity) => i.id === targetId);
  if (fromIndex === -1 || toIndex === -1) return;
  await reorderIdentities(browser, identitySetters, fromIndex, toIndex);
}

function handleIdentityDragEnd() {
  draggedIdentityId = null;
  dropTargetIdentityId = null;
}

let newIdentityFirstNames = $state('');
let newIdentityLastNames = $state('');
let newIdentityName = $state('');
let newIdentityUseRandomPassword = $state(true);
let newIdentityCustomPassword = $state('');
let newIdentityPhone = $state('');
let newIdentityPin = $state('');
let newIdentityDomainHints = $state<string[]>([]);
let newDomainHintInput = $state('');
let validationError = $state('');

onDestroy(() => {
  for (const timer of holdTimers.values()) {
    clearTimeout(timer);
  }
  holdTimers.clear();
});

const identitySetters = {
  setIdentities: (ids: Identity[]) => {
    identities = ids;
  },
  setSelectedIdentityId: (id: string | null) => {
    selectedIdentityId = id;
  },
};

async function loadIdentitiesData() {
  await loadIdentities(browser, identitySetters);
}

function openIdentityEditor(identity: Identity) {
  editingIdentity = identity;
  newIdentityName = identity.name;
  newIdentityFirstNames = identity.firstNames;
  newIdentityLastNames = identity.lastNames;
  newIdentityUseRandomPassword = identity.useRandomPassword;
  newIdentityCustomPassword = identity.customPassword || '';
  newIdentityPhone = identity.phone || '';
  newIdentityPin = identity.pin || '';
  newIdentityDomainHints = identity.domainHints ? [...identity.domainHints] : [];
  newDomainHintInput = '';
}

function closeIdentityEditor() {
  editingIdentity = null;
  newIdentityName = '';
  newIdentityFirstNames = '';
  newIdentityLastNames = '';
  newIdentityUseRandomPassword = true;
  newIdentityCustomPassword = '';
  newIdentityPhone = '';
  newIdentityPin = '';
  newIdentityDomainHints = [];
  newDomainHintInput = '';
  validationError = '';
}

async function saveIdentityChanges() {
  if (!editingIdentity) return;

  try {
    const trimmedName = validateTextInput(newIdentityName, 'Identity name', 64);

    // Check for duplicate name (excluding the identity being edited)
    const isDuplicateName = identities.some(
      (i) => i.id !== editingIdentity!.id && i.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (isDuplicateName) {
      validationError = `An identity named "${trimmedName}" already exists. Please choose a different name.`;
      return;
    }

    const updatedIdentity: Identity = {
      ...editingIdentity,
      name: trimmedName,
      firstNames: validateTextInput(newIdentityFirstNames, 'First names', 500),
      lastNames: validateTextInput(newIdentityLastNames, 'Last names', 500),
      useRandomPassword: newIdentityUseRandomPassword,
      customPassword: newIdentityUseRandomPassword
        ? undefined
        : validateOptionalPassword(newIdentityCustomPassword),
      phone: validateOptionalPhone(newIdentityPhone),
      pin: validateOptionalPin(newIdentityPin),
      domainHints: newIdentityDomainHints.filter((h) => h.trim()),
    };

    await saveIdentity(browser, updatedIdentity, identitySetters);
    closeIdentityEditor();
  } catch (error) {
    validationError = getErrorMessage(error);
  }
}

async function deleteIdentityHandler(identityId: string) {
  // eslint-disable-next-line lint/style/useTemplate
  if (confirm(`${$t('identities.delete')}?`)) {
    await deleteIdentity(browser, identityId, identitySetters);
  }
}

function startHold(id: string) {
  holdTimers.set(
    id,
    setTimeout(() => {
      selectionMode = true;
      selectedIds = new Set([id]);
      holdTimers.delete(id);
    }, 500)
  );
}

function cancelHold(id: string) {
  const t = holdTimers.get(id);
  if (t !== undefined) {
    clearTimeout(t);
    holdTimers.delete(id);
  }
}

function toggleSelect(id: string) {
  const next = new Set(selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds = next;
  if (selectedIds.size === 0) selectionMode = false;
}

function exitSelectionMode() {
  selectionMode = false;
  selectedIds = new Set();
}

async function deleteSelected() {
  const ids = [...selectedIds];
  if (!confirm(`Delete ${ids.length} identit${ids.length === 1 ? 'y' : 'ies'}?`)) return;
  for (const id of ids) {
    await deleteIdentity(browser, id, identitySetters);
  }
  exitSelectionMode();
}

async function selectIdentityHandler(identityId: string) {
  await selectIdentity(browser, identityId, identitySetters);
}

function openCreateDialog() {
  showCreateDialog = true;
  const firstNames = DEFAULT_FIRST_NAMES.join(', ');
  const lastNames = DEFAULT_LAST_NAMES.join(', ');
  newIdentityName = 'My Identity';
  newIdentityFirstNames = firstNames;
  newIdentityLastNames = lastNames;
  newIdentityUseRandomPassword = true;
  newIdentityCustomPassword = '';
  newIdentityPhone = '';
  newIdentityPin = '';
}

function closeCreateDialog() {
  showCreateDialog = false;
  newIdentityName = '';
  newIdentityFirstNames = '';
  newIdentityLastNames = '';
  newIdentityUseRandomPassword = true;
  newIdentityCustomPassword = '';
  newIdentityPhone = '';
  newIdentityPin = '';
  validationError = '';
}

async function createNewIdentity() {
  try {
    const trimmedName = validateTextInput(newIdentityName, 'Identity name', 64);

    // Check for duplicate name
    const isDuplicateName = identities.some(
      (i) => i.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (isDuplicateName) {
      validationError = `An identity named "${trimmedName}" already exists. Please choose a different name.`;
      return;
    }

    const newIdentity: Identity = {
      id: `identity_${Date.now()}`,
      name: trimmedName,
      firstNames: validateTextInput(newIdentityFirstNames, 'First names', 500),
      lastNames: validateTextInput(newIdentityLastNames, 'Last names', 500),
      useRandomPassword: newIdentityUseRandomPassword,
      customPassword: newIdentityUseRandomPassword
        ? undefined
        : validateOptionalPassword(newIdentityCustomPassword),
      phone: validateOptionalPhone(newIdentityPhone),
      pin: validateOptionalPin(newIdentityPin),
      isDefault: false,
      createdAt: Date.now(),
    };

    await saveIdentity(browser, newIdentity, identitySetters);
    await selectIdentity(browser, newIdentity.id, identitySetters);
    closeCreateDialog();
  } catch (error) {
    validationError = getErrorMessage(error);
  }
}

function validateOptionalPassword(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  validatePassword(trimmed);
  return trimmed;
}

function validateOptionalPhone(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  validatePhoneNumber(trimmed);
  return trimmed;
}

function validateOptionalPin(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  validateOTP(trimmed);
  return trimmed;
}

loadIdentitiesData();
</script>

<div class="flex flex-col h-full relative">
  <!-- Header -->
  <div class="px-5 py-4 border-b border-md-secondary-container">
    <div class="flex items-center justify-end gap-2">
      {#if selectionMode}
        <span class="text-xs text-md-on-surface/60 mr-auto">{selectedIds.size} selected</span>
        <button
          class="px-3 py-1.5 text-sm rounded-lg bg-md-error text-md-on-error hover:bg-md-error/90 transition-colors flex items-center gap-2 disabled:opacity-50"
          disabled={selectedIds.size === 0}
          onclick={deleteSelected}
        >
          <Icon name="trash" class="w-4 h-4" />
          Delete
        </button>
        <button
          class="px-3 py-1.5 text-sm rounded-lg bg-md-secondary-container text-md-on-surface hover:bg-md-secondary-container/80 transition-colors"
          onclick={exitSelectionMode}
        >
          <Icon name="x" class="w-4 h-4" />
        </button>
      {:else}
        <button class="btn-primary px-3 py-1.5 text-sm rounded-lg flex items-center gap-2" onclick={openCreateDialog}>
          <Icon name="plus" class="w-4 h-4" />
          {$t('identities.create')}
        </button>
      {/if}
    </div>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto pb-16">
    {#if editingIdentity}
      <!-- Identity Editor -->
      <div class="p-5">
        <div class="flex items-center gap-3 mb-6">
          <button class="w-8 h-8 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-secondary-container transition-colors" onclick={closeIdentityEditor} aria-label="Close">
            <Icon name="x" class="w-5 h-5" />
          </button>
          <h3 class="font-semibold text-base">{$t('identities.edit')}</h3>
        </div>

        <div class="space-y-4">
          <!-- Identity Name -->
          <div class="bg-md-primary-container rounded-xl px-4 py-3">
            <label for="identity-name" class="text-xs text-md-on-surface/50 mb-1 block">{$t('identities.name')}</label>
            <input
              id="identity-name"
              type="text"
              class="w-full px-3 py-2 rounded-lg border border-md-outline-variant text-sm bg-md-secondary-container outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
              placeholder="My Identity, Work, Personal, ..."
              bind:value={newIdentityName}
            />
          </div>

          <!-- Name Selection -->
          <div class="bg-md-primary-container rounded-xl px-4 py-3">
            <div class="text-sm font-medium text-md-secondary mb-3">Names</div>
            <div class="space-y-3">
              <div>
                <label for="first-names" class="text-xs text-md-on-surface/50 mb-1 block">{$t('identities.firstNames')}</label>
                <input
                  id="first-names"
                  type="text"
                  class="w-full px-3 py-2 rounded-lg border border-md-outline-variant text-sm bg-md-secondary-container outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
                  placeholder="James, John, Robert, ..."
                  bind:value={newIdentityFirstNames}
                />
              </div>
              <div>
                <label for="last-names" class="text-xs text-md-on-surface/50 mb-1 block">{$t('identities.lastNames')}</label>
                <input
                  id="last-names"
                  type="text"
                  class="w-full px-3 py-2 rounded-lg border border-md-outline-variant text-sm bg-md-secondary-container outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
                  placeholder="Smith, Johnson, Williams, ..."
                  bind:value={newIdentityLastNames}
                />
              </div>
            </div>
          </div>

          <!-- Password Settings -->
          <div class="bg-md-primary-container rounded-xl px-4 py-3">
            <div class="flex items-center justify-between mb-3">
              <div class="text-sm font-medium text-md-tertiary mb-3">{$t('identities.password')}</div>
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  class="sr-only peer"
                  bind:checked={newIdentityUseRandomPassword}
                />
                <div class="relative w-9 h-5 bg-md-outline-variant peer-checked:bg-md-primary rounded-full peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                <span class="text-xs text-md-on-surface/50">{$t('identities.randomPassword')}</span>
              </label>
            </div>
            {#if !newIdentityUseRandomPassword}
              <input
                type="password"
                class="w-full px-3 py-2 rounded-lg border border-md-outline-variant text-sm bg-md-secondary-container outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
                placeholder="{$t('identities.customPassword')}"
                bind:value={newIdentityCustomPassword}
              />
            {/if}
          </div>

          <!-- Phone Number -->
          <div class="bg-md-primary-container rounded-xl px-4 py-3">
            <div class="text-sm font-medium text-md-secondary mb-3">{$t('identities.phoneNumber')}</div>
            <input
              type="tel"
              class="w-full px-3 py-2 rounded-lg border border-md-outline-variant text-sm bg-md-secondary-container outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
              placeholder="{$t('identities.optional')}"
              bind:value={newIdentityPhone}
            />
          </div>

          <!-- PIN Code -->
          <div class="bg-md-primary-container rounded-xl px-4 py-3">
            <div class="text-sm font-medium text-md-tertiary mb-3">{$t('identities.pinCode')}</div>
            <input
              type="text"
              class="w-full px-3 py-2 rounded-lg border border-md-outline-variant text-sm bg-md-secondary-container outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
              placeholder="{$t('identities.optional')}"
              bind:value={newIdentityPin}
              maxlength="8"
            />
          </div>

          <!-- Domain Hints -->
          <div class="bg-md-primary-container rounded-xl px-4 py-3">
            <div class="text-sm font-medium text-md-secondary mb-1">{$t('identities.domainHints')}</div>
            <p class="text-xs text-md-on-surface/50 mb-3">{$t('identities.domainHintsDescription')}</p>
            <div class="flex gap-2 mb-2">
              <input
                type="text"
                class="flex-1 px-3 py-2 rounded-lg border border-md-outline-variant text-sm bg-md-secondary-container outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
                placeholder="github.com"
                bind:value={newDomainHintInput}
                onkeydown={(e) => {
                  if (e.key === 'Enter' && newDomainHintInput.trim()) {
                    e.preventDefault();
                    const hint = newDomainHintInput.trim().toLowerCase();
                    if (!newIdentityDomainHints.includes(hint)) {
                      newIdentityDomainHints = [...newIdentityDomainHints, hint];
                    }
                    newDomainHintInput = '';
                  }
                }}
              />
              <button
                class="px-3 py-2 rounded-lg bg-md-secondary-container text-md-on-surface hover:bg-md-secondary-container/80 transition-colors text-sm"
                onclick={() => {
                  if (newDomainHintInput.trim()) {
                    const hint = newDomainHintInput.trim().toLowerCase();
                    if (!newIdentityDomainHints.includes(hint)) {
                      newIdentityDomainHints = [...newIdentityDomainHints, hint];
                    }
                    newDomainHintInput = '';
                  }
                }}
              >
                {$t('common.add')}
              </button>
            </div>
            {#if newIdentityDomainHints.length > 0}
              <div class="flex flex-wrap gap-1.5">
                {#each newIdentityDomainHints as hint, i}
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-md-secondary-container text-xs text-md-on-surface">
                    {hint}
                    <button
                      class="w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-md-error/20 transition-colors"
                      onclick={() => { newIdentityDomainHints = newIdentityDomainHints.filter((_, idx) => idx !== i); }}
                      aria-label="Remove"
                    >
                      <Icon name="x" class="w-2.5 h-2.5" />
                    </button>
                  </span>
                {/each}
              </div>
            {/if}
          </div>

          {#if validationError}
            <p class="text-xs text-md-error">{validationError}</p>
          {/if}

          <!-- Save Button -->
          <button class="w-full px-4 py-2 text-sm rounded-lg bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors" onclick={saveIdentityChanges}>
            {$t('identities.save')}
          </button>
        </div>
      </div>
    {:else}
      <!-- Identity List -->
      <div class="p-5 space-y-3">
        {#each identities as identity}
          {@const isChecked = selectedIds.has(identity.id)}
          {@const isDragging = draggedIdentityId === identity.id}
          {@const isDropTarget = dropTargetIdentityId === identity.id}
          {@const linkedDomains = [...new Set(savedLogins.filter((l: CredentialsHistoryItem) => l.identityId != null && String(l.identityId) === identity.id).map((l: CredentialsHistoryItem) => {
              try {
                const site = l.website || l.domain || '';
                return site.startsWith('http') ? new URL(site).hostname : site;
              } catch { return l.domain || ''; }
            }).filter(Boolean))].slice(0, 5)}
          <div
            class="relative bg-md-tertiary-container rounded-xl px-4 py-3 flex items-center justify-between transition-all {selectedIdentityId === identity.id && !selectionMode ? 'ring-2 ring-md-primary' : ''} {selectionMode && isChecked ? 'ring-2 ring-md-secondary' : ''} {!selectionMode ? 'cursor-move' : ''} {isDragging ? 'opacity-50' : ''} {isDropTarget ? 'ring-2 ring-md-primary' : ''}"
            draggable={!selectionMode}
            role="listitem"
            ondragstart={(e) => handleIdentityDragStart(e, identity.id)}
            ondragover={(e) => handleIdentityDragOver(e, identity.id)}
            ondragleave={() => handleIdentityDragLeave(identity.id)}
            ondrop={(e) => handleIdentityDrop(e, identity.id)}
            ondragend={handleIdentityDragEnd}
            aria-label={$t('identities.dragToReorder', { values: { name: identity.name } })}
          >
            {#if identity === identities[0] && !selectionMode && !dragHintDismissed}
              <DragHint
                hintKey="dragHintSeen_identities"
                text={$t('identities.dragHint')}
                visible={true}
                onDismiss={handleIdentityDragHintDismiss}
              />
            {/if}
            <div
              class="flex items-center gap-3 flex-1 min-w-0"
              onclick={() => {
                if (selectionMode) { toggleSelect(identity.id); }
                else { openIdentityEditor(identity); }
              }}
              onpointerdown={() => { if (!selectionMode) startHold(identity.id); }}
              onpointerup={() => cancelHold(identity.id)}
              onpointerleave={() => cancelHold(identity.id)}
              onkeydown={(e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (selectionMode) toggleSelect(identity.id);
                  else openIdentityEditor(identity);
                }
              }}
              role="button"
              tabindex="0"
            >
            <div class="flex items-center gap-3">
              {#if selectionMode}
                <div class="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 {isChecked ? 'bg-md-secondary border-md-secondary' : 'border-md-outline-variant'}">
                  {#if isChecked}<span class="text-md-on-secondary text-[10px] font-bold">✓</span>{/if}
                </div>
              {:else}
                <div class="w-10 h-10 rounded-full bg-md-primary/10 flex items-center justify-center">
                  <Icon name="user" class="w-5 h-5 text-md-primary" />
                </div>
              {/if}
              <div>
                <div class="font-medium text-sm">{identity.name}</div>
                <div class="text-xs text-md-on-surface/50">
                  {identity.useRandomPassword ? $t('identities.randomPassword') : $t('identities.customPassword')}
                  {#if identity.phone}
                    • Phone: {identity.phone}
                  {/if}
                </div>
                {#if linkedDomains.length > 0}
                  <div class="flex items-center gap-1 mt-1.5 flex-wrap">
                    {#each linkedDomains as domain (domain)}
                      {@const d = domain as string}
                      <div class="w-5 h-5 rounded-md bg-md-secondary-container flex items-center justify-center overflow-hidden shrink-0" title={d}>
                        <FaviconImage
                          domain={d}
                          size={20}
                          class="w-4 h-4 object-contain"
                          fallbackLetter={d.charAt(0).toUpperCase()}
                          fallbackColor="bg-md-primary"
                        />
                      </div>
                    {/each}
                    {#if linkedDomains.length === 5}
                      <span class="text-[9px] text-md-on-surface/40">+more</span>
                    {/if}
                  </div>
                {/if}
                {#if identity.domainHints && identity.domainHints.length > 0}
                  <div class="flex items-center gap-1 mt-1 flex-wrap">
                    <Icon name="globe" class="w-3 h-3 text-md-tertiary shrink-0" />
                    {#each identity.domainHints.slice(0, 3) as hint}
                      <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-md-primary/10 text-md-primary">{hint}</span>
                    {/each}
                    {#if identity.domainHints.length > 3}
                      <span class="text-[9px] text-md-on-surface/40">+{identity.domainHints.length - 3}</span>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
            </div>
            <div class="flex items-center gap-2">
              {#if !selectionMode}
                {#if selectedIdentityId === identity.id}
                  <span class="px-2 py-0.5 text-xs font-medium rounded-full bg-md-primary/20 text-md-primary">Default</span>
                {/if}
                <button
                  class="w-6 h-6 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-secondary-container text-md-error transition-colors"
                  onclick={(e) => {
                    e.stopPropagation();
                    deleteIdentityHandler(identity.id);
                  }}
                  aria-label="Delete identity"
                >
                  <Icon name="trash" class="w-4 h-4" />
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Default for Autofill - Fixed at bottom (same styling as InboxView autofill strip) -->
  <div class="absolute bottom-0 left-0 right-0 z-10 flex justify-center transition-all duration-200">
    <div class="h-[40px] w-[350px] flex items-center box-border px-3 bg-md-primary-container rounded-xl">
      <div class="flex items-center gap-2 w-full">
        <!-- Identity Selector -->
        <div class="relative flex-1 min-w-0">
          <div
            class="flex items-center gap-1 bg-md-secondary-container/70 rounded-full px-2.5 py-1 cursor-pointer relative"
            role="button"
            tabindex="0"
            onclick={() => showIdentityDropdown = !showIdentityDropdown}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                showIdentityDropdown = !showIdentityDropdown;
              }
            }}
          >
            <Icon name="user" class="w-3 h-3 text-md-secondary flex-shrink-0" />
            <div class="flex-1 min-w-0 text-[11px] font-medium text-md-on-surface pr-2 truncate">
              {identities.find(i => i.id === selectedIdentityId)?.name || $t('identities.select')}
            </div>
            <Icon name="chevronDown" class="w-2.5 h-2.5 text-md-on-surface/40 flex-shrink-0 transition-transform {showIdentityDropdown ? 'rotate-180' : ''}" />

            <!-- Dropup Menu -->
            {#if showIdentityDropdown}
              <div class="absolute bottom-full left-0 right-0 mb-1 bg-md-primary-container border border-md-secondary-container rounded-xl shadow-lg z-50 max-h-48 overflow-y-auto">
                {#each identities as identity}
                  <button
                    class="w-full text-left px-3 py-2 text-[11px] font-medium text-md-on-surface hover:bg-md-secondary-container transition-colors first:rounded-t-xl last:rounded-b-xl"
                    onclick={(e) => {
                      e.stopPropagation();
                      selectedIdentityId = identity.id;
                      selectIdentity(browser, identity.id, identitySetters);
                      showIdentityDropdown = false;
                    }}
                  >
                    {identity.name}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Create Dialog -->
  {#if showCreateDialog}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="bg-md-primary-container rounded-2xl p-5 w-full max-w-md">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-semibold text-base">{$t('identities.create')}</h3>
          <button class="w-8 h-8 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-secondary-container transition-colors" onclick={closeCreateDialog} aria-label="Close">
            <Icon name="x" class="w-5 h-5" />
          </button>
        </div>

        <div class="space-y-4">
          <!-- Identity Name -->
          <div>
            <label for="create-identity-name" class="text-xs text-md-on-surface/50 mb-1 block">{$t('identities.name')}</label>
            <input
              id="create-identity-name"
              type="text"
              class="w-full px-3 py-2 rounded-lg border border-md-outline-variant text-sm bg-md-secondary-container outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
              placeholder="My Identity, Work, Personal, ..."
              bind:value={newIdentityName}
            />
          </div>

          <!-- Name Selection -->
          <div>
            <label for="create-first-names" class="text-xs text-md-on-surface/50 mb-1 block">{$t('identities.firstNames')}</label>
            <input
              id="create-first-names"
              type="text"
              class="w-full px-3 py-2 rounded-lg border border-md-outline-variant text-sm bg-md-secondary-container outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
              placeholder="James, John, Robert, ..."
              bind:value={newIdentityFirstNames}
            />
          </div>
          <div>
            <label for="create-last-names" class="text-xs text-md-on-surface/50 mb-1 block">{$t('identities.lastNames')}</label>
            <input
              id="create-last-names"
              type="text"
              class="w-full px-3 py-2 rounded-lg border border-md-outline-variant text-sm bg-md-secondary-container outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
              placeholder="Smith, Johnson, Williams, ..."
              bind:value={newIdentityLastNames}
            />
          </div>

          <!-- Password Settings -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label for="create-password" class="text-xs text-md-on-surface/50">{$t('identities.password')}</label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  class="sr-only peer"
                  bind:checked={newIdentityUseRandomPassword}
                />
                <div class="relative w-9 h-5 bg-md-outline-variant peer-checked:bg-md-primary rounded-full peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                <span class="text-xs text-md-on-surface/50">{$t('identities.randomPassword')}</span>
              </label>
            </div>
            {#if !newIdentityUseRandomPassword}
              <input
                id="create-password"
                type="password"
                class="w-full px-3 py-2 rounded-lg border border-md-outline-variant text-sm bg-md-secondary-container outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
                placeholder="{$t('identities.customPassword')}"
                bind:value={newIdentityCustomPassword}
              />
            {/if}
          </div>

          <!-- Phone Number -->
          <div>
            <label for="create-phone" class="text-xs text-md-on-surface/50 mb-1 block">{$t('identities.phoneNumber')} ({$t('identities.optional')})</label>
            <input
              id="create-phone"
              type="tel"
              class="w-full px-3 py-2 rounded-lg border border-md-outline-variant text-sm bg-md-secondary-container outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
              placeholder="{$t('identities.optional')}"
              bind:value={newIdentityPhone}
            />
          </div>

          <!-- PIN Code -->
          <div>
            <label for="create-pin" class="text-xs text-md-on-surface/50 mb-1 block">{$t('identities.pinCode')} ({$t('identities.optional')})</label>
            <input
              id="create-pin"
              type="text"
              class="w-full px-3 py-2 rounded-lg border border-md-outline-variant text-sm bg-md-secondary-container outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
              placeholder="{$t('identities.optional')}"
              bind:value={newIdentityPin}
              maxlength="8"
            />
          </div>

          {#if validationError}
            <p class="text-xs text-md-error">{validationError}</p>
          {/if}

          <!-- Create Button -->
          <button class="w-full px-4 py-2 text-sm rounded-lg bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors" onclick={createNewIdentity}>
            {$t('identities.save')}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
