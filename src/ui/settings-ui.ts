import { getSettings, updateSettings } from '../settings.js';
import * as history from '../history.js';
import { toast } from './feedback.js';
import { showScreen } from './router.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function openSettingsPage(): void {
  fill();
  showScreen('s-settings');
}

export function bindSettings(onChanged: () => void): void {
  const s = getSettings();

  const bindCheck = (id: string, key: keyof typeof s) => {
    $(`s-${id}`).onchange = (e) => {
      updateSettings({ [key]: (e.target as HTMLInputElement).checked } as never);
      onChanged();
    };
  };
  const bindSelect = (id: string, key: keyof typeof s) => {
    $(`s-${id}`).onchange = (e) => {
      const v = (e.target as HTMLSelectElement).value;
      updateSettings({
        [key]: typeof v === 'string' && !isNaN(Number(v)) && key === 'autoCleanDays' ? Number(v) : v,
      } as never);
      onChanged();
    };
  };

  bindCheck('savehist', 'saveHistory');
  bindSelect('autoclean', 'autoCleanDays');
  bindCheck('sound', 'sound');
  bindCheck('vibrate', 'vibrate');
  bindCheck('autoopen', 'autoOpen');
  bindSelect('mode', 'mode');
  bindSelect('area', 'area');
  bindSelect('group', 'group');
  bindSelect('theme', 'theme');
  bindSelect('lowperf', 'lowPerf');

  $('s-wipe').onclick = () => {
    if (confirm('将清除全部本地数据（历史/设置），确定？')) {
      localStorage.clear();
      toast('本地数据已清除');
      setTimeout(() => location.reload(), 600);
    }
  };
}

function fill(): void {
  const s = getSettings();
  $<HTMLInputElement>('s-savehist').checked = s.saveHistory;
  $<HTMLSelectElement>('s-autoclean').value = String(s.autoCleanDays);
  $<HTMLInputElement>('s-sound').checked = s.sound;
  $<HTMLInputElement>('s-vibrate').checked = s.vibrate;
  $<HTMLInputElement>('s-autoopen').checked = s.autoOpen;
  $<HTMLSelectElement>('s-mode').value = s.mode;
  $<HTMLSelectElement>('s-area').value = s.area;
  $<HTMLSelectElement>('s-group').value = s.group;
  $<HTMLSelectElement>('s-theme').value = s.theme;
  $<HTMLSelectElement>('s-lowperf').value = s.lowPerf;
}

/** 启动时执行一次自动清理 */
export function runStartupClean(): void {
  const days = getSettings().autoCleanDays;
  if (days > 0) history.autoClean(days);
}
