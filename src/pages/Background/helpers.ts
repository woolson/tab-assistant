
export const Logger = {
  debug: true,

  prifix: '[Tab Assistant]',

  log(...args: any[]) {
    console.log(this.prifix, ...args);
  }
}