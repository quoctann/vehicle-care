import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { vi } from './locales/vi'

void i18n.use(initReactI18next).init({
  resources: { vi },
  lng: 'vi',
  fallbackLng: 'vi',
  supportedLngs: ['vi'],
  interpolation: { escapeValue: false },
})

export default i18n
