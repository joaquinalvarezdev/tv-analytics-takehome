import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { provideApiConfiguration } from './api/generated/api-configuration';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(),
    // Relative root URL: the Angular dev server proxies /api -> the backend (see proxy.conf.json),
    // and in a real deployment the SPA and API would share an origin behind the same host too.
    provideApiConfiguration(''),
  ],
};
