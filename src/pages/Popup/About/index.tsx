import React, { useCallback } from "react"
import { Button, message, Result } from "antd"
import { DownloadOutlined, ExportOutlined, GithubOutlined, SmileOutlined } from "@ant-design/icons"
import Icon from '@/assets/img/icon.svg';
import FileSaver from 'file-saver';
import "./style.less"
import { StorageKeyEnum } from "@/common/const";
import { reloadConfig } from "@/common";

export const About = () => {
  const exportSetting = useCallback(async () => {
    const storage = await chrome.storage.sync.get([
      StorageKeyEnum.RULES,
      StorageKeyEnum.SETTING
    ])
    const blob = new Blob([JSON.stringify(storage, null, 2)], { type: 'text/plain' });
    FileSaver.saveAs(blob, "tab-assistant-setting.json");
    message.success('设置保存成功')
  }, []);

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
        reloadConfig()
      } catch (e) {
        message.error('设置导入失败')
      }
    };
    reader.readAsText(file);
  }, []);

  return (
    <Result
      className="tab-assistant-about"
      icon={<img src={Icon} width={130} />}
      title={<h3 style={{ margin: '0' }}>标签分组助手</h3>}
      subTitle="规则自动化分组浏览器标签页"
      extra={[
        <Button
          key="about"
          icon={<GithubOutlined />}
          onClick={() => chrome.tabs.create({ url: "https://github.com/woolson/TabAssistant" })}>
          GitHub
        </Button>,
        <Button
          key="save-setting"
          icon={<ExportOutlined />}
          onClick={exportSetting}>
          导出规则和设置
        </Button>,
        <Button
          key="import-setting"
          icon={<DownloadOutlined />}
          onClick={importSetting}>
          导入规则和设置
        </Button>,
      ]}
    />
  )
}

export default About