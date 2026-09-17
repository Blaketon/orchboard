import type { Skill } from '../shared/api.ts';
import { errorMessage, requestJson } from './api.ts';
import { el } from './dom.ts';

type SourceFilter = 'all' | Skill['source'];

/** Filters skills by source and by a search over name, description, and path. */
export function filterSkills(
  skills: readonly Skill[],
  source: SourceFilter,
  query: string,
): Skill[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return skills.filter((skill) => {
    if (source !== 'all' && skill.source !== source) return false;
    const haystack = `${skill.name} ${skill.description} ${skill.path}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** A searchable list of the skills installed for Claude Code and Codex. */
export function createSkillsDialog(): { open(): void } {
  let skills: Skill[] = [];
  let failure: string | null = null;
  let loading = false;

  const search = el('input', {
    className: 'field-input',
    attrs: {
      type: 'search',
      placeholder: 'Search skills',
      'aria-label': 'Search skills',
      autocomplete: 'off',
    },
  });
  const source = el(
    'select',
    { className: 'field-input field-auto', attrs: { 'aria-label': 'Source' } },
    [
      el('option', { text: 'All sources', attrs: { value: 'all' } }),
      el('option', { text: 'Claude Code', attrs: { value: 'Claude' } }),
      el('option', { text: 'Codex', attrs: { value: 'Codex' } }),
    ],
  );
  const reload = el('button', { className: 'button', text: 'Reload', attrs: { type: 'button' } });
  const summary = el('p', { className: 'skills-summary', attrs: { role: 'status' } });
  const list = el('ul', { className: 'skills-list' });
  const close = el('button', { className: 'button', text: 'Close', attrs: { type: 'button' } });

  const dialog = el(
    'dialog',
    { className: 'modal modal-wide', attrs: { 'aria-labelledby': 'skills-title' } },
    [
      el('div', { className: 'form' }, [
        el('div', {}, [
          el('h2', { className: 'form-title', text: 'Skills', attrs: { id: 'skills-title' } }),
          el('p', {
            className: 'form-message',
            text: 'Installed for Claude Code (~/.claude/skills) and Codex (~/.codex/skills). Agents load a skill when its description matches the task.',
          }),
        ]),
        el('div', { className: 'skills-toolbar' }, [search, source, reload]),
        summary,
        list,
        el('div', { className: 'form-actions' }, [close]),
      ]),
    ],
  );
  document.body.append(dialog);

  function render(): void {
    if (loading && !skills.length) {
      summary.textContent = 'Loading skills…';
      list.replaceChildren();
      return;
    }
    if (failure) {
      summary.textContent = `Could not load skills: ${failure}`;
      list.replaceChildren();
      return;
    }
    const filter: SourceFilter =
      source.value === 'Claude' || source.value === 'Codex' ? source.value : 'all';
    const shown = filterSkills(skills, filter, search.value);
    const count = `${shown.length} skill${shown.length === 1 ? '' : 's'}`;
    summary.textContent = shown.length === skills.length ? count : `${count} of ${skills.length}`;
    list.replaceChildren(
      ...(shown.length
        ? shown.map(renderSkill)
        : [
            el('li', {
              className: 'skills-empty',
              text: skills.length ? 'No skills match.' : 'No skills installed.',
            }),
          ]),
    );
  }

  async function load(): Promise<void> {
    loading = true;
    render();
    try {
      skills = await requestJson<Skill[]>('GET', '/api/skills');
      failure = null;
    } catch (error) {
      failure = errorMessage(error);
    } finally {
      loading = false;
      render();
    }
  }

  search.addEventListener('input', render);
  source.addEventListener('change', render);
  reload.addEventListener('click', () => void load());
  close.addEventListener('click', () => {
    dialog.close();
  });

  return {
    open() {
      dialog.showModal();
      search.focus();
      void load();
    },
  };
}

function renderSkill(skill: Skill): HTMLLIElement {
  const description = el('p', {
    className: 'skill-description',
    text: skill.description || 'No description.',
  });
  // Long descriptions are clamped to a few lines; clicking shows the rest.
  description.addEventListener('click', () => {
    description.toggleAttribute('data-expanded');
  });
  return el('li', { className: 'skill' }, [
    el('div', { className: 'skill-header' }, [
      el('span', { className: 'skill-name', text: skill.name }),
      el('span', {
        className: 'skill-tag',
        text: skill.source === 'Claude' ? 'Claude Code' : 'Codex',
      }),
      skill.system
        ? el('span', {
            className: 'skill-tag',
            text: 'Built-in',
            attrs: { title: 'Ships with the tool' },
          })
        : null,
    ]),
    description,
    el('code', { className: 'skill-path', text: skill.path, attrs: { title: skill.path } }),
  ]);
}
