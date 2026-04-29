// /js/project_settings.js
export async function applyProjectSettings() {
  try {
    const res = await fetch('/project-settings');
    const data = await res.json();
    if (!res.ok || !data?.ok) throw new Error(data.error || 'Failed to fetch settings');

    const s = data.settings || {};
    const secondary = s.tool_secondary_name || '';

    // Update every UI element that mirrors the secondary/tagline text from Supabase.
    document.querySelectorAll('.brand-subtitle, [data-project-secondary]').forEach(el => {
      el.textContent = secondary;
    });

    // Optionally update document title
    if (s.project_name) {
      document.title = s.project_name;
    }
  } catch (err) {
    console.warn('⚠️ Could not load project settings:', err);
  }
}

