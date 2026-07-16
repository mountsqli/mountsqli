// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { sidebar } from './src/sidebar.ts';
import MountSQLiLOgo from './src/assets/MountSQLi-logo.png'
import mermaid from 'astro-mermaid';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'MountSQLI',
			description: 'Next-generation type-safe ORM & backend platform.',
			logo: {
				src: `${MountSQLiLOgo}`,
				alt: 'MountSQLi',
			},
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/mountsqli/mountsqli' }],
			sidebar,
			expressiveCode: { themes: ['github-dark-dimmed', 'github-light'] },
			editLink: {
				baseUrl: 'https://github.com/mountsqli/mountsqli/edit/main/docs',
			},
		}),
		mermaid({
      theme: 'forest',
      autoTheme: true
    }),
	],
});
