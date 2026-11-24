import { version } from "../../package.json";
import { Icon } from "./Icon";

export function AboutNota() {
  return <section className="about-nota" aria-label="关于 Nota">
    <div className="about-brand">
      <img src="/assets/nota-agent-builtin.png" width="46" height="46" alt="" />
      <h3>Nota</h3>
    </div>
    <p className="about-intro">读论文，记批注，和 Agent 一起讨论。</p>
    <div className="about-version">
      <div><span>当前版本</span><strong>{version}</strong></div>
      <a href="https://github.com/zhangzitaooo/nota/releases" target="_blank" rel="noopener noreferrer">
        查看发布记录<Icon name="source" size={13} />
      </a>
    </div>
    <nav className="about-contact" aria-label="联系作者">
      <a href="https://zhangzitaooo.github.io/nota/" target="_blank" rel="noopener noreferrer">
        <Icon name="globe" size={16} />官网
      </a>
      <a href="mailto:zhangzitao997@gmail.com" target="_blank" rel="noopener noreferrer" title="zhangzitao997@gmail.com">
        <Icon name="mail" size={16} />邮件反馈
      </a>
      <a className="about-author-link" href="https://www.xiaohongshu.com/user/profile/6034a0a50000000001007e43" target="_blank" rel="noopener noreferrer">
        小红书戳我<span aria-hidden="true">↗</span>
      </a>
    </nav>
  </section>;
}
