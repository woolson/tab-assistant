import React, { useCallback } from "react"
import { Button, Drawer, message, Result, Row, Space, Tag } from "antd"
import { DownloadOutlined, ExportOutlined, GithubOutlined } from "@ant-design/icons"
import Icon from '@/assets/img/icon.svg';
import FileSaver from 'file-saver';
import { StorageKeyEnum } from "@/common/const";
import { reloadConfig } from "@/common";
import { useSetState } from "ahooks";
import PackageJson from '../../../../package.json';
import "./style.less"

export const About = () => {
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
    <>
      <Result
        className="tab-assistant-about"
        icon={<img src={Icon} width={130} />}
        title={<h3 style={{ margin: '0' }}>标签分组助手</h3>}
        subTitle="规则自动化分组浏览器标签页"
        extra={
          <>
            <Row justify="center">
              <Space>
                {/* <Button
                  icon={<GithubOutlined />}
                  onClick={() => chrome.tabs.create({ url: "https://github.com/woolson/TabAssistant" })}>
                  GitHub
                </Button> */}
                <Button
                  icon={<ExportOutlined />}
                  onClick={exportSetting}>
                  导出规则和设置
                </Button>
                <Button
                  icon={<DownloadOutlined />}
                  onClick={importSetting}>
                  导入规则和设置
                </Button>
              </Space>
            </Row>
            <Row style={{fontFamily: 'monospace', marginTop: 10}} justify="center">
              <Space size="small">
                <div>当前版本: v{PackageJson.version} / 作者：Woolson Lee</div>
                <Button type="link" onClick={() => setState({ showChangeLogModal: true })}>
                  更新日志
                </Button>
              </Space>
            </Row>
          </>
        }
      />

      <Drawer
        title="更新日志"
        open={state.showChangeLogModal}
        width="80%"
        onClose={() => setState({ showChangeLogModal: false })}>
        <h3>1.1.0 (2024-11-17)</h3>
        <p><Tag color="volcano">NEW</Tag><b>新增功能：</b></p>
        <ol>
          <li>支持一键全部折叠和全部展开</li>
          <li>支持分组拖动排序</li>
          <li>支持分组名忽略多个关键词</li>
          <li>支持配置内容导出和导入</li>
          <li>增加配置界面暗黑模式（和浏览器暗黑模式联动，不可手动更改）</li>
          <li>增加版本更新日志</li>
        </ol>
        <p><Tag color="green">OTHER</Tag>其他优化：</p>
        <ol>
          <li>配置窗口样式细节优化，更精致</li>
          <li>更换插件的 Logo</li>
          <li>首次使用体验优化</li>
          <li>其他内部兼容性提升</li>
        </ol>
        <h3>1.0.0 (2022-07-19)</h3>
        <p><Tag color="volcano">NEW</Tag><b>新增功能：</b></p>
        <ol>
          <li>分组规则管理，新增标签页按规则自动分组</li>
          <li>为匹配到分组的标签页按域名分组，域名分组按字母排序</li>
          <li>配置忽略 www. 关键词</li>
        </ol>
      </Drawer>
    </>
  )
}

export default About