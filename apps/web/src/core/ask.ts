// Questions that need an answer before going on: "Delete this routine?", "Name the folder". Shown by AskHost.vue.
import { reactive } from "vue";

interface Ask { title: string; text?: string; ok: string; danger?: boolean; input?: { value: string; placeholder?: string } | null; choices?: { label: string; value: string }[]; resolve: (v: any) => void }
export const asking = reactive<{ cur: Ask | null }>({ cur: null });

export const confirm = (title: string, o: { text?: string; ok?: string; danger?: boolean } = {}) =>
  new Promise<boolean>((resolve) => { asking.cur = { title, text: o.text, ok: o.ok ?? "OK", danger: o.danger, resolve }; });
export const prompt = (title: string, o: { value?: string; placeholder?: string; ok?: string; text?: string } = {}) =>
  new Promise<string | null>((resolve) => { asking.cur = { title, text: o.text, ok: o.ok ?? "Save", input: { value: o.value ?? "", placeholder: o.placeholder }, resolve }; });
export const choose = (title: string, choices: { label: string; value: string }[], text?: string) =>
  new Promise<string | null>((resolve) => { asking.cur = { title, text, ok: "", choices, resolve }; });
