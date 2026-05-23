<script lang="ts">
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import IconChevronDown from '@/components/icons/IconChevronDown.svelte';
import IconPlus from '@/components/icons/IconPlus.svelte';
import IconTrash from '@/components/icons/IconTrash.svelte';
import IconUser from '@/components/icons/IconUser.svelte';
import IconX from '@/components/icons/IconX.svelte';
import {
  deleteIdentity,
  loadIdentities,
  saveIdentity,
  selectIdentity,
} from '@/features/identities/identity-actions.js';
import { logError } from '@/utils/logger.js';
import type { Identity } from '@/utils/types.js';

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

let { context = 'popup', onBack = () => {} } = $props<{
  context?: 'popup' | 'sidepanel' | 'app';
  onBack?: () => void;
}>();

let identities = $state<Identity[]>([]);
let selectedIdentityId = $state<string | null>(null);
let editingIdentity = $state<Identity | null>(null);
let showCreateDialog = $state(false);
let showIdentityDropdown = $state(false);

let newIdentityFirstNames = $state('');
let newIdentityLastNames = $state('');
let newIdentityName = $state('');
let newIdentityUseRandomPassword = $state(true);
let newIdentityCustomPassword = $state('');
let newIdentityPhone = $state('');
let newIdentityPin = $state('');

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
}

async function saveIdentityChanges() {
  if (!editingIdentity) return;

  const updatedIdentity: Identity = {
    ...editingIdentity,
    name: newIdentityName,
    firstNames: newIdentityFirstNames,
    lastNames: newIdentityLastNames,
    useRandomPassword: newIdentityUseRandomPassword,
    customPassword: newIdentityCustomPassword || undefined,
    phone: newIdentityPhone || undefined,
    pin: newIdentityPin || undefined,
  };

  await saveIdentity(browser, updatedIdentity, identitySetters);
  closeIdentityEditor();
}

async function deleteIdentityHandler(identityId: string) {
  // eslint-disable-next-line lint/style/useTemplate
  if (confirm(`${$t('identities.delete')}?`)) {
    await deleteIdentity(browser, identityId, identitySetters);
  }
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
}

async function createNewIdentity() {
  const newIdentity: Identity = {
    id: `identity_${Date.now()}`,
    name: newIdentityName,
    firstNames: newIdentityFirstNames,
    lastNames: newIdentityLastNames,
    useRandomPassword: newIdentityUseRandomPassword,
    customPassword: newIdentityCustomPassword || undefined,
    phone: newIdentityPhone || undefined,
    pin: newIdentityPin || undefined,
    isDefault: false,
    createdAt: Date.now(),
  };

  await saveIdentity(browser, newIdentity, identitySetters);
  await selectIdentity(browser, newIdentity.id, identitySetters);
  closeCreateDialog();
}

loadIdentitiesData();
</script>

<div class="flex flex-col h-full relative">
  <!-- Header -->
  <div class="px-5 py-4 border-b border-md-secondary-container">
    <div class="flex items-center justify-end">
      <button class="btn-primary px-3 py-1.5 text-sm rounded-lg flex items-center gap-2" onclick={openCreateDialog}>
        <IconPlus class="w-4 h-4" />
        {$t('identities.create')}
      </button>
    </div>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto pb-16" style="scrollbar-width: thin; scrollbar-color: var(--md-primary) transparent;">
    {#if editingIdentity}
      <!-- Identity Editor -->
      <div class="p-5">
        <div class="flex items-center gap-3 mb-6">
          <button class="w-8 h-8 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-secondary-container transition-colors" onclick={closeIdentityEditor} aria-label="Close">
            <IconX class="w-5 h-5" />
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
          <div
            class="bg-md-tertiary-container rounded-xl px-4 py-3 flex items-center justify-between {selectedIdentityId === identity.id ? 'ring-2 ring-md-primary' : ''}"
            onclick={() => openIdentityEditor(identity)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openIdentityEditor(identity);
              }
            }}
            role="button"
            tabindex="0"
            aria-label={`Edit identity: ${identity.name}`}
          >
            <div class="flex items-center gap-3">
              <div
                class="w-10 h-10 rounded-full bg-md-primary/10 flex items-center justify-center">
                <IconUser class="w-5 h-5 text-md-primary" />
              </div>
              <div>
                <div class="font-medium text-sm">{identity.name}</div>
                <div class="text-xs text-md-on-surface/50">
                  {identity.useRandomPassword ? $t('identities.randomPassword') : $t('identities.customPassword')}
                  {#if identity.phone}
                    • Phone: {identity.phone}
                  {/if}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              {#if identity.isDefault}
                <span class="px-2 py-0.5 text-xs font-medium rounded-full bg-md-primary/20 text-md-primary">Default</span>
              {/if}
              {#if selectedIdentityId === identity.id}
                <span class="px-2 py-0.5 text-xs font-medium rounded-full bg-md-success/20 text-md-success">Selected</span>
              {/if}
              <button
                class="w-6 h-6 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-secondary-container text-md-error transition-colors"
                onclick={(e) => {
                  e.stopPropagation();
                  deleteIdentityHandler(identity.id);
                }}
                aria-label="Delete identity"
              >
                <IconTrash class="w-4 h-4" />
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Default for Autofill - Fixed at bottom (same styling as InboxView autofill strip) -->
  <div class="absolute bottom-0 left-0 right-0 z-10 flex justify-center transition-all duration-200">
    <div class="px-3 bg-md-primary-container rounded-xl" style="height: 40px; width: 350px; display: flex; align-items: center; box-sizing: border-box;">
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
            <IconUser class="w-3 h-3 text-md-secondary flex-shrink-0" />
            <div class="flex-1 min-w-0 text-[11px] font-medium text-md-on-surface pr-2 truncate">
              {identities.find(i => i.id === selectedIdentityId)?.name || $t('identities.select')}
            </div>
            <IconChevronDown class="w-2.5 h-2.5 text-md-on-surface/40 flex-shrink-0 transition-transform {showIdentityDropdown ? 'rotate-180' : ''}" />

            <!-- Dropup Menu -->
            {#if showIdentityDropdown}
              <div class="absolute bottom-full left-0 right-0 mb-1 bg-md-primary-container border border-md-secondary-container rounded-xl shadow-lg z-50 max-h-48 overflow-y-auto" style="scrollbar-width: thin; scrollbar-color: var(--md-primary) transparent;">
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
            <IconX class="w-5 h-5" />
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

          <!-- Create Button -->
          <button class="w-full px-4 py-2 text-sm rounded-lg bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors" onclick={createNewIdentity}>
            {$t('identities.save')}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
