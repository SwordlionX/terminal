/**
 * Greek'lerin SABİT açıklamaları — fiyatlama ekranındaki bilgi baloncukları bunu gösterir.
 * Bilinçli olarak değişkene bağlı DEĞİL: rakam yorumu değil, kavram anlatılıyor.
 */
export const GREEK_INFO: Record<string, { title: string; text: string }> = {
  delta: {
    title: 'Delta',
    text: 'Dayanak varlık 1 birim hareket ettiğinde opsiyon priminin kaç birim değişeceğini gösterir. Call için 0 ile 1, put için −1 ile 0 arasındadır. Kabaca "opsiyonun kârda kapanma olasılığı" olarak da okunur ve delta-hedge için kaç birim dayanak alınıp satılacağını söyler.',
  },
  gamma: {
    title: 'Gamma',
    text: 'Delta’nın kendisinin ne kadar hızlı değiştiğini gösterir. Gamma yüksekse küçük fiyat hareketlerinde delta hızla kayar, yani hedge sık güncellenmek zorunda kalır. En yüksek olduğu yer başabaşa yakın ve vadeye az kalmış opsiyonlardır.',
  },
  theta: {
    title: 'Theta (Günlük)',
    text: 'Başka hiçbir şey değişmezse opsiyonun bir günde kaybedeceği zaman değeridir. Opsiyonu satan taraf için gelir, alan taraf için maliyettir. Vade yaklaştıkça büyür.',
  },
  vega: {
    title: 'Vega',
    text: 'Volatilite 1 puan (%1) arttığında primin ne kadar değişeceğini gösterir. Uzun vadeli ve başabaşa yakın opsiyonlarda en yüksektir. Vol satan bir masanın asıl taşıdığı risk budur.',
  },
  rho: {
    title: 'Rho',
    text: 'Faiz oranı %1 arttığında primin ne kadar değişeceğini gösterir. Kısa vadeli opsiyonlarda etkisi küçüktür, vade uzadıkça önem kazanır.',
  },
  charm: {
    title: 'Charm (Delta Decay)',
    text: 'Sadece zaman geçtiği için delta’nın bir günde ne kadar kayacağını gösterir. Hedge’in kendiliğinden bozulma hızıdır; vade sonuna yakın hafta sonlarında özellikle dikkat edilir.',
  },
  vanna: {
    title: 'Vanna',
    text: 'Volatilite değiştiğinde delta’nın ne kadar değişeceğini (aynı şekilde: spot değiştiğinde vega’nın ne kadar değişeceğini) gösterir. Skew riskinin ölçüsüdür; bariyerli ve egzotik yapılarda kritiktir.',
  },
  vomma: {
    title: 'Vomma',
    text: 'Volatilite değiştiğinde vega’nın ne kadar değişeceğini gösterir. Vol’ün kendisinin oynaklığına duyarlılıktır; kanatlardaki (derin OTM) opsiyonlarda yüksektir.',
  },
};

/** Başabaş kutusunun açıklaması — işlem ekranlarında kullanılıyor. */
export const BREAKEVEN_INFO =
  'Vade sonunda müşterinin net kâr/zararının sıfır olduğu dayanak fiyatı: opsiyonun içsel değeri, alınan/ödenen primi tam karşılar. Call’da kullanım fiyatı + birim prim, put’ta kullanım fiyatı − birim prim. Seviye alış ve satışta aynıdır; değişen, hangi tarafın kâr olduğudur. Bariyerli işlemlerde bariyere değilmediği varsayımıyla geçerlidir.';
