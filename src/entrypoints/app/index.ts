import { mount } from 'svelte';
import App from './App.svelte';
import '../../styles.css';

const api =
  (window as { browser?: unknown }).browser ?? (window as { chrome?: unknown }).chrome ?? {};
(window as { browser?: unknown; chrome?: unknown }).browser = api;
(window as { browser?: unknown; chrome?: unknown }).chrome = api;

const target = document.getElementById('app');
if (target) mount(App, { target });
