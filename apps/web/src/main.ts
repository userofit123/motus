import { createApp } from "vue";
import { VueQueryPlugin } from "@tanstack/vue-query";
import App from "./App.vue";
import { router } from "./router";
import { queryClient } from "./api/live";
import { startTheme } from "./core/theme";
import "./styles/index.css";

startTheme();
createApp(App).use(router).use(VueQueryPlugin, { queryClient }).mount("#app");
