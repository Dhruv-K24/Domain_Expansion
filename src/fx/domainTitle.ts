// DomainTitle — the "DOMAIN EXPANSION / <NAME>" text at the bottom of the screen.
//
// One component, many looks: the LAYOUT and TIMING live here; the LOOK lives in CSS under a
// theme class (.theme-void, .theme-shrine, ...). A new domain = pick a theme, pass a name.
//
// Optional `cut`: when the name appears, a slash cuts "DOMAIN EXPANSION" in half and the two
// halves slide apart (used by Malevolent Shrine).

export type TitleTiming = { showDE: number; showName: number; fade: number; end: number }

export class DomainTitle {
  private el: HTMLDivElement
  private timing: TitleTiming
  private cut: boolean

  constructor(name: string, theme: string, timing: TitleTiming, cut = false) {
    this.timing = timing
    this.cut = cut
    this.el = document.createElement('div')
    this.el.className = `domain-title theme-${theme}`
    // DE is written twice (top half + bottom half, each clipped) so it can be "cut"
    this.el.innerHTML = `
      <div class="de">
        <span class="half top">DOMAIN EXPANSION</span>
        <span class="half bot">DOMAIN EXPANSION</span>
      </div>
      <i class="cutline"></i>
      <div class="name"></div>`
    this.el.querySelector('.name')!.textContent = name
    document.body.append(this.el)
  }

  play() {
    this.stop()
    this.el.classList.add('on')
  }

  /** called every frame with the domain's time: add each class once its moment arrives.
   *  (Driven by domain time, not timers, so the title stays in sync if the animation pauses.) */
  tick(t: number) {
    const { showDE, showName, fade, end } = this.timing
    const cl = this.el.classList
    if (t >= showDE) cl.add('s1')
    if (t >= showName) { cl.add('s2'); if (this.cut) cl.add('cut') }
    if (t >= fade) cl.add('fade')
    if (t >= end) this.stop()
  }

  stop() {
    this.el.classList.remove('on', 's1', 's2', 'cut', 'fade')
  }
}
