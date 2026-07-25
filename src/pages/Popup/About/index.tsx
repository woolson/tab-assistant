import React, { useCallback } from "react"
import { Button, Divider, Drawer, message, Result, Row, Space, Tag, theme } from "antd"
import { ShareAltOutlined } from "@ant-design/icons"
import Logo from '@/assets/img/icon.svg';
import FileSaver from 'file-saver';
import { StorageKeyEnum } from "@/common/const";
import { openLink, reloadConfig } from "@/common";
import { useSetState } from "ahooks";
import { Language, useI18n } from "@/common/i18n";
import PackageJson from '../../../../package.json';
import "./style.less"

export const About = () => {
  const { token } = theme.useToken();
  const { setLanguage, t } = useI18n();

  console.log(token)

  const [state, setState] = useSetState({
    /** 显示变更日志 */
    showChangeLogModal: false
  });

  const exportSetting = useCallback(async () => {
    const storage = await chrome.storage.sync.get([
      StorageKeyEnum.RULES,
      StorageKeyEnum.SETTING
    ])
    const blob = new Blob([JSON.stringify(storage, null, 2)], { type: 'text/plain' });
    FileSaver.saveAs(blob, "tab-assistant-setting.json");
    message.success(t('settingsSaved'))
  }, [t]);

  const importSetting = useCallback(async () => {
    const file = await new Promise<File>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = (e) => {
        const files = (e.target as HTMLInputElement).files;
        if (files && files.length > 0) {
          resolve(files[0]);
        }
      };
      input.click();
    })
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      try {
        const data = JSON.parse(text);
        await chrome.storage.sync.set(data);
        const importedLanguage = data?.[StorageKeyEnum.SETTING]?.language as Language | undefined;
        if (importedLanguage === 'zh-CN' || importedLanguage === 'en-US') {
          setLanguage(importedLanguage);
        }
        reloadConfig(t('ruleUpdateSuccess'))
      } catch (e) {
        message.error(t('settingsImportFailed'))
      }
    };
    reader.readAsText(file);
  }, [setLanguage, t]);

  return (
    <>
      <Result
        className="tab-assistant-about"
        icon={<img src={Logo} width={200} />}
        title={<h3 style={{ margin: '0' }}>{t('appTitle')}</h3>}
        subTitle={t('appDescription')}
        extra={
          <div style={{ backgroundColor: token.colorBgContainerDisabled, padding: '15px 20px 20px', borderRadius: '8px' }}>
            <Row style={{ fontFamily: 'monospace' }} justify="center">
              <Space size="small">
                <div>
                  {t('currentVersion')}
                  <Button
                    type="link"
                    style={{ padding: '0' }}
                    onClick={() => openLink('https://chromewebstore.google.com/detail/%E6%A0%87%E7%AD%BE%E5%88%86%E7%BB%84%E5%8A%A9%E6%89%8B/obdaljfdjocbdmpofhncldmfppjeemda?authuser=0&hl=zh-CN')}>
                    v{PackageJson.version}<ShareAltOutlined />
                  </Button>
                </div>
                <span>/</span>
                <span>
                  {t('author')}
                  <Button
                    type="link"
                    style={{ padding: '0' }}
                    onClick={() => openLink('https://github.com/woolson')}>
                    Woolson Lee
                  </Button>
                </span>
                <span>/</span>
                <Button
                  type="link"
                  style={{ padding: '0' }}
                  onClick={() => setState({ showChangeLogModal: true })}>
                  {t('changelog')}
                </Button>
                <span>/</span>
                <Button
                  type="link"
                  style={{ padding: '0' }}
                  onClick={() => openLink('https://github.com/woolson/TabAssistant/issues')}>
                  {t('feedback')}
                </Button>
              </Space>
            </Row>
            <Row justify="center" style={{ marginTop: '10px' }}>
              <Space>
                {/* <Button
                  icon={<GithubOutlined />}
                  onClick={() => chrome.tabs.create({ url: "https://github.com/woolson/TabAssistant" })}>
                  GitHub
                </Button> */}
                <Button
                  onClick={exportSetting}
                  style={{ boxShadow: 'none' }}>
                  <span>{t('exportRulesSettings')}</span>
                </Button>
                <Button
                  onClick={importSetting}
                  style={{ boxShadow: 'none' }}>
                  <span>{t('importRulesSettings')}</span>
                </Button>
              </Space>
            </Row>
          </div>
        }
      />

      <Drawer
        title={t('changelog')}
        open={state.showChangeLogModal}
        width="80%"
        onClose={() => setState({ showChangeLogModal: false })}>
        <h3>1.3.2 (2026-07-25)</h3>
        <p><Tag color="volcano" style={{ fontWeight: 'bolder' }}>NEW</Tag><b>{t('newFeature')}</b></p>
        <ol>
          <li>{t('changelog1321')}</li>
        </ol>
        <Divider dashed />
        <h3>1.3.1 (2026-05-11)</h3>
        <p><Tag color="volcano" style={{ fontWeight: 'bolder' }}>NEW</Tag><b>{t('newFeature')}</b></p>
        <ol>
          <li>{t('changelog1301')}</li>
          <li>{t('changelog1302')}</li>
          <li>{t('changelog1303')}</li>
        </ol>
        <p><Tag color="lime">ETC</Tag>{t('etc')}</p>
        <ol>
          <li>{t('changelog1304')}</li>
          <li>{t('changelog1305')}</li>
        </ol>
        <Divider dashed />
        <h3>1.2.0 (2024-11-25)</h3>
        <p><Tag color="volcano" style={{ fontWeight: 'bolder' }}>NEW</Tag><b>{t('newFeature')}</b></p>
        <ol>
          <li>{t('changelog1201')}</li>
          <li>{t('changelog1202')}</li>
          <li>{t('changelog1203')}</li>
        </ol>
        <p><Tag color="lime">ETC</Tag>{t('etc')}</p>
        <ol>
          <li>{t('changelog1204')}</li>
        </ol>
        <Divider dashed />
        <h3>1.1.2 (2024-11-24)</h3>
        <p><Tag color="lime">ETC</Tag>{t('etc')}</p>
        <ol>
          <li>{t('changelog1121')}</li>
        </ol>
        <Divider dashed />
        <h3>1.1.1 (2024-11-24)</h3>
        <p><Tag color="lime">ETC</Tag>{t('etc')}</p>
        <ol>
          <li>{t('changelog1111')}</li>
        </ol>
        <Divider dashed />
        <h3>1.1.0 (2024-11-17)</h3>
        <p><Tag color="volcano" style={{ fontWeight: 'bolder' }}>NEW</Tag><b>{t('newFeature')}</b></p>
        <ol>
          <li>{t('changelog1101')}</li>
          <li>{t('changelog1102')}</li>
          <li>{t('changelog1103')}</li>
          <li>{t('changelog1104')}</li>
          <li>{t('changelog1105')}</li>
          <li>{t('changelog1106')}</li>
        </ol>
        <p><Tag color="lime">ETC</Tag>{t('etc')}</p>
        <ol>
          <li>{t('changelog1107')}</li>
          <li>{t('changelog1108')}</li>
          <li>{t('changelog1109')}</li>
          <li>{t('changelog1110')}</li>
        </ol>
        <Divider dashed />
        <h3>1.0.0 (2022-07-19)</h3>
        <p><Tag color="volcano" style={{ fontWeight: 'bolder' }}>NEW</Tag><b>{t('newFeature')}</b></p>
        <ol>
          <li>{t('changelog1001')}</li>
          <li>{t('changelog1002')}</li>
          <li>{t('changelog1003')}</li>
        </ol>
      </Drawer>
    </>
  )
}

export default About
