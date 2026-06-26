// ===========================================================================
// HARVESTED from paraleagle-ext src/content/formik-bridge.ts (origin/main —
// identical to the fix/i129-doc-upload-batching working tree). Kept INTACT:
// the 2026-06-25 spike proved this writes to the online I-130 unmodified.
// Do not edit the fiber-walk logic without re-verifying live.
// ===========================================================================
//
// Runs in the page's MAIN world — can access React fiber properties.
// Communicates with the isolated-world content script via CustomEvent on
// document. Registered in manifest.json with "world": "MAIN" to bypass CSP.

document.addEventListener("mk-autofill-set-formik", (e: Event) => {
  const { elementId, fieldName, value } = (e as CustomEvent).detail;
  const el = document.getElementById(elementId);
  if (!el) return;

  const fiberKey = Object.keys(el).find(
    (k) =>
      k.startsWith("__reactFiber$") ||
      k.startsWith("__reactInternalInstance$"),
  );
  if (!fiberKey) {
    el.setAttribute("data-formik-set", "no-fiber");
    return;
  }

  let fiber = (el as any)[fiberKey];
  for (let i = 0; i < 30 && fiber; i++) {
    const setFV = findSetFieldValue(fiber);
    if (setFV) {
      setFV(fieldName, value);
      el.setAttribute("data-formik-set", "ok");
      return;
    }
    fiber = fiber.return;
  }
  el.setAttribute("data-formik-set", "no-formik");
});

function findSetFieldValue(fiber: any): ((name: string, val: any) => void) | null {
  const props = fiber.memoizedProps;

  // 1. Render-props: <Field> passes form as prop
  if (props?.form?.setFieldValue) return props.form.setFieldValue;
  // 2. connect() HOC
  if (props?.formik?.setFieldValue) return props.formik.setFieldValue;
  // 3. Direct prop
  if (typeof props?.setFieldValue === "function") return props.setFieldValue;

  // 4. Context Provider: <FormikContext.Provider value={formikBag}>
  // React stores context values on Provider fibers' memoizedProps.value
  if (props?.value && typeof props.value === "object" && typeof props.value.setFieldValue === "function") {
    return props.value.setFieldValue;
  }

  // 5. Context consumer dependencies (useContext resolved values)
  // React stores resolved context on consumer fibers at fiber.dependencies.firstContext
  // as a linked list of { context, memoizedValue, next }
  let dep = fiber.dependencies?.firstContext;
  while (dep) {
    const ctxVal = dep.memoizedValue;
    if (ctxVal && typeof ctxVal === 'object') {
      // Formik context
      if (typeof ctxVal.setFieldValue === 'function') return ctxVal.setFieldValue;
      // React Hook Form context (need both setValue + getValues to avoid false positives)
      if (typeof ctxVal.setValue === 'function' && typeof ctxVal.getValues === 'function') {
        return (name: string, val: any) => ctxVal.setValue(name, val, { shouldValidate: true });
      }
    }
    dep = dep.next;
  }

  // 6. Class component instances may have form methods
  const inst = fiber.stateNode;
  if (inst && typeof inst === 'object' && !(inst instanceof HTMLElement)) {
    if (typeof inst.setFieldValue === 'function') return inst.setFieldValue;
    if (typeof inst.props?.formik?.setFieldValue === 'function') return inst.props.formik.setFieldValue;
  }

  // 7. Hooks: walk memoizedState linked list (useFormikContext stores context here)
  let hook = fiber.memoizedState;
  for (let j = 0; j < 20 && hook; j++) {
    const state = hook.memoizedState;
    if (state && typeof state === "object" && typeof state.setFieldValue === "function") {
      return state.setFieldValue;
    }
    const qState = hook.queue?.lastRenderedState;
    if (qState && typeof qState === "object" && typeof qState.setFieldValue === "function") {
      return qState.setFieldValue;
    }
    hook = hook.next;
  }

  return null;
}
