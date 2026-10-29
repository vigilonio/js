function validateDraft(draft) {
  if (!draft.title) {
    throw new Error("draft-title-missing");
  }
}

export async function saveDraft(draft) {
  await Promise.resolve();
  validateDraft(draft);
}

export async function onSaveClick(draft) {
  await saveDraft(draft);
}
